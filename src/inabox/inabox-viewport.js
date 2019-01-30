/**
 * Copyright 2016 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {MessageType} from '../../src/3p-frame-messaging';
import {Observable} from '../observable';
import {PositionObserver} from '../../ads/inabox/position-observer';
import {Services} from '../services';
import {Viewport} from '../service/viewport/viewport-impl';
import {ViewportBindingDef} from '../service/viewport/viewport-binding-def';
import {dev, devAssert} from '../log';
import {iframeMessagingClientFor} from './inabox-iframe-messaging-client';
import {isExperimentOn} from '../experiments';
import {
  layoutRectFromDomRect,
  layoutRectLtwh,
  moveLayoutRect,
} from '../layout-rect';
import {px, resetStyles, setImportantStyles} from '../style';
import {registerServiceBuilderForDoc} from '../service';
import {throttle} from '../utils/rate-limit';

/** @const {string} */
const TAG = 'inabox-viewport';

/** @const {number} */
const MIN_EVENT_INTERVAL = 100;

/**
 * @param {!Window} win
 * @param {!Element} bodyElement
 * @visibleForTesting
 */
export function prepareBodyForOverlay(win, bodyElement) {
  return Services.vsyncFor(win).runPromise({
    measure: state => {
      state.width = win./*OK*/innerWidth;
      state.height = win./*OK*/innerHeight;
    },
    mutate: state => {
      // We need to override runtime-level !important rules
      setImportantStyles(bodyElement, {
        'background': 'transparent',
        'left': '50%',
        'top': '50%',
        'right': 'auto',
        'bottom': 'auto',
        'position': 'absolute',
        'height': px(state.height),
        'width': px(state.width),
        'margin-top': px(-state.height / 2),
        'margin-left': px(-state.width / 2),
      });
    },
  }, {});
}


/**
 * @param {!Window} win
 * @param {!Element} bodyElement
 * @visibleForTesting
 */
export function resetBodyForOverlay(win, bodyElement) {
  return Services.vsyncFor(win).mutatePromise(() => {
    // We're not resetting background here as it's supposed to remain
    // transparent.
    resetStyles(bodyElement, [
      'position',
      'left',
      'top',
      'right',
      'bottom',
      'width',
      'height',
      'margin-left',
      'margin-top',
    ]);
  });
}


/**
 * Implementation of ViewportBindingDef that works inside an non-scrollable
 * iframe box by listening to host doc for position and resize updates.
 *
 * @visibleForTesting
 * @implements {ViewportBindingDef}
 */
export class ViewportBindingInabox {

  /**
   * @param {!Window} win
   */
  constructor(win) {
    /** @const {!Window} */
    this.win = win;

    /** @private @const {!Observable} */
    this.scrollObservable_ = new Observable();

    /** @private @const {!Observable} */
    this.resizeObservable_ = new Observable();

    const boxWidth = win./*OK*/innerWidth;
    const boxHeight = win./*OK*/innerHeight;

    /**
     * The current viewport rect.
     * Before hearing from host doc, we're blind about the viewport position
     * and iframe position. 0 scroll is not a bad guess.
     * Meanwhile, use iframe box size as the viewport size gives a good
     * initial resource scheduling.
     * @private {!../layout-rect.LayoutRectDef}
     */
    this.viewportRect_ = layoutRectLtwh(0, 0, boxWidth, boxHeight);

    /**
     * The current layout rect of the iframe box.
     * TODO(lannka, #7971): The best way to stop visibility from firing
     * is to move this functionality to the InOb polyfill.
     * ~To not trigger amp-analytics visibility immediately,
     * we start with an initial position right below the fold.~
     * @private {!../layout-rect.LayoutRectDef}
     */
    this.boxRect_ = layoutRectLtwh(0, boxHeight + 1, boxWidth, boxHeight);

    /** @private @const {!../../3p/iframe-messaging-client.IframeMessagingClient} */
    this.iframeClient_ = iframeMessagingClientFor(win);

    /** @private {?Promise<!../layout-rect.LayoutRectDef>} */
    this.requestPositionPromise_ = null;

    /** @private {function()} */
    this.fireScrollThrottle_ = throttle(this.win, () => {
      this.scrollObservable_.fire();
    }, MIN_EVENT_INTERVAL);

    /** @private @const {boolean} */
    this.useLayers_ = isExperimentOn(this.win, 'layers');

    /** @private {?../../ads/inabox/position-observer.PositionObserver} */
    this.topWindowPositionObserver_ = null;

    dev().fine(TAG, 'initialized inabox viewport');
  }

  /** @override */
  connect() {
    if (this.canInspectTopWindow_()) {
      this.listenForPositionSameDomain_();
    }
    else {
      this.listenForPosition_();
    }
  }

  /**
   * @private
   * @param {!../layout-rect.LayoutRectDef} viewportRect
   * @param {!../layout-rect.LayoutRectDef} targetRect
   */
  updateLayoutRects_(viewportRect, targetRect) {
    const oldViewportRect = this.viewportRect_;
    this.viewportRect_ = viewportRect;
    this.updateBoxRect_(targetRect);
    if (isResized(this.viewportRect_, oldViewportRect)) {
      this.resizeObservable_.fire();
    }
    if (isMoved(this.viewportRect_, oldViewportRect)) {
      this.fireScrollThrottle_();
    }
  }

  /** @private */
  listenForPosition_() {
    this.iframeClient_.makeRequest(
        MessageType.SEND_POSITIONS, MessageType.POSITION,
        data => {
          dev().fine(TAG, 'Position changed: ', data);
          this.updateLayoutRects_(data['viewportRect'], data['targetRect']);
        });
  }

  /**
   * Returns true if top win's properties can be accessed and win is defined.
   * This functioned is used to determine if the host window is cross-domained
   * from the perspective of the current window.
   * @return {boolean}
   * @private
   */
  canInspectTopWindow_() {
    // TODO: This should be changed in the future.
    // See https://github.com/google/closure-compiler/issues/3156
    try {
      // win['test'] could be truthy but not true the compiler shouldn't be able
      // to optimize this check away.
      return !!this.win.top.location.href && (this.win.top['test'] || true);
    } catch (unusedErr) { // eslint-disable-line no-unused-vars
      return false;
    }
  }

  /** @visibleForTesting */
  setUpNativeListener() {
    // Set up listener but only after the resources service is properly
    // registered (since it's registered after the inabox services so it won't
    // be available immediately).
    return Services.resourcesPromiseForDoc(this.win.document.documentElement)
        .then(() => {
          this.topWindowPositionObserver_ = new PositionObserver(this.win.top);
          this.topWindowPositionObserver_.observe(
              this.win.frameElement, data => {
                this.updateLayoutRects_(
                    data['viewportRect'],
                    data['targetRect']);
              });
        });
  }

  /** @private */
  listenForPositionSameDomain_() {
    this.setUpNativeListener();
  }

  /** @override */
  getLayoutRect(el) {
    const b = el./*OK*/getBoundingClientRect();
    let {left, top} = b;
    if (this.useLayers_) {
      left -= this.viewportRect_.left;
      top -= this.viewportRect_.top;
    }
    return layoutRectLtwh(
        Math.round(left + this.boxRect_.left),
        Math.round(top + this.boxRect_.top),
        Math.round(b.width),
        Math.round(b.height));
  }

  /** @override */
  onScroll(callback) {
    this.scrollObservable_.add(callback);
  }

  /** @override */
  onResize(callback) {
    this.resizeObservable_.add(callback);
  }

  /** @override */
  getSize() {
    return {
      width: this.viewportRect_.width,
      height: this.viewportRect_.height,
    };
  }

  /** @override */
  getScrollTop() {
    return this.viewportRect_.top;
  }

  /** @override */
  getScrollLeft() {
    return this.viewportRect_.left;
  }

  /** @override */
  getScrollingElement() {
    return this.getBodyElement();
  }

  /** @override */
  getScrollingElementScrollsLikeViewport() {
    return true;
  }

  /** @override */
  supportsPositionFixed() {
    return false;
  }

  /**
   * @param {?../layout-rect.LayoutRectDef|undefined} positionRect
   * @private
   */
  updateBoxRect_(positionRect) {
    if (!positionRect) {
      return;
    }

    const boxRect = moveLayoutRect(positionRect, this.viewportRect_.left,
        this.viewportRect_.top);

    if (isChanged(boxRect, this.boxRect_)) {
      dev().fine(TAG, 'Updating viewport box rect: ', boxRect);

      this.boxRect_ = boxRect;
      // Remeasure all AMP elements once iframe position or size are changed.
      // Because all layout boxes are calculated relatively to the
      // iframe position.
      this.remeasureAllElements_();
      // TODO: fire DOM mutation event once we handle them
    }
  }

  /**
   * @return {!Array<!../service/resource.Resource>}
   * @visibleForTesting
   */
  getChildResources() {
    return Services.resourcesForDoc(this.win.document.documentElement).get();
  }

  /** @private */
  remeasureAllElements_() {
    this.getChildResources().forEach(resource => resource.measure());
  }

  /** @override */
  updateLightboxMode(lightboxMode) {
    if (lightboxMode) {
      return this.tryToEnterOverlayMode_();
    }
    return this.leaveOverlayMode_();
  }

  /** @override */
  getRootClientRectAsync() {
    if (this.canInspectTopWindow_()) {
      return new Promise(resolve => {
        resolve(layoutRectFromDomRect(
            this.win.frameElement./*OK*/getBoundingClientRect()));
      });
    }
    if (!this.requestPositionPromise_) {
      this.requestPositionPromise_ = new Promise(resolve => {
        this.iframeClient_.requestOnce(
            MessageType.SEND_POSITIONS, MessageType.POSITION,
            data => {
              this.requestPositionPromise_ = null;
              devAssert(data.targetRect, 'Host should send targetRect');
              resolve(data.targetRect);
            }
        );
      });
    }
    return this.requestPositionPromise_;
  }


  /**
   * @return {!Promise}
   * @private
   */
  tryToEnterOverlayMode_() {
    return this.prepareBodyForOverlay_()
        .then(() => this.requestFullOverlayFrame_());
  }

  /**
   * @return {!Promise}
   * @private
   */
  leaveOverlayMode_() {
    return this.requestCancelFullOverlayFrame_()
        .then(() => this.resetBodyForOverlay_());
  }

  /**
   * Prepares the "fixed" container before expanding frame.
   * @return {!Promise}
   * @private
   */
  prepareBodyForOverlay_() {
    return prepareBodyForOverlay(this.win, this.getBodyElement());
  }

  /**
   * Resets the "fixed" container to its original position after collapse.
   * @return {!Promise}
   * @private
   */
  resetBodyForOverlay_() {
    return resetBodyForOverlay(this.win, this.getBodyElement());
  }

  /**
   * @return {!Promise}
   * @private
   */
  requestFullOverlayFrame_() {
    return new Promise((resolve, reject) => {
      const unlisten = this.iframeClient_.makeRequest(
          MessageType.FULL_OVERLAY_FRAME,
          MessageType.FULL_OVERLAY_FRAME_RESPONSE,
          response => {
            unlisten();
            if (response['success']) {
              this.updateBoxRect_(response['boxRect']);
              resolve();
            } else {
              reject('Request to open lightbox rejected by host document');
            }
          });
    });
  }

  /**
   * @return {!Promise}
   * @private
   */
  requestCancelFullOverlayFrame_() {
    return new Promise(resolve => {
      const unlisten = this.iframeClient_.makeRequest(
          MessageType.CANCEL_FULL_OVERLAY_FRAME,
          MessageType.CANCEL_FULL_OVERLAY_FRAME_RESPONSE,
          response => {
            unlisten();
            this.updateBoxRect_(response['boxRect']);
            resolve();
          });
    });
  }

  /** @visibleForTesting */
  getBodyElement() {
    return dev().assertElement(this.win.document.body);
  }

  /** @override */ disconnect() {/* no-op */}
  /** @override */ updatePaddingTop() {/* no-op */}
  /** @override */ hideViewerHeader() {/* no-op */}
  /** @override */ showViewerHeader() {/* no-op */}
  /** @override */ disableScroll() {/* no-op */}
  /** @override */ resetScroll() {/* no-op */}
  /** @override */ ensureReadyForElements() {/* no-op */}
  /** @override */ setScrollTop() {/* no-op */}
  /** @override */ getScrollWidth() {return 0;}
  /** @override */ getScrollHeight() {return 0;}
  /** @override */ getContentHeight() {return 0;}
  /** @override */ contentHeightChanged() {}
  /** @override */ getBorderTop() {return 0;}
  /** @override */ requiresFixedLayerTransfer() {return false;}
}

/**
 * @param {!../service/ampdoc-impl.AmpDoc} ampdoc
 */
export function installInaboxViewportService(ampdoc) {
  const binding = new ViewportBindingInabox(ampdoc.win);
  const viewer = Services.viewerForDoc(ampdoc);
  registerServiceBuilderForDoc(ampdoc,
      'viewport',
      function() {
        return new Viewport(ampdoc, binding, viewer);
      },
      /* opt_instantiate */ true);
}

/**
 * @param {!../layout-rect.LayoutRectDef} newRect
 * @param {!../layout-rect.LayoutRectDef} oldRect
 * @return {boolean}
 */
function isChanged(newRect, oldRect) {
  return isMoved(newRect, oldRect) || isResized(newRect, oldRect);
}

/**
 * @param {!../layout-rect.LayoutRectDef} newRect
 * @param {!../layout-rect.LayoutRectDef} oldRect
 * @return {boolean}
 */
function isMoved(newRect, oldRect) {
  return newRect.left != oldRect.left || newRect.top != oldRect.top;
}

/**
 * @param {!../layout-rect.LayoutRectDef} newRect
 * @param {!../layout-rect.LayoutRectDef} oldRect
 * @return {boolean}
 */
function isResized(newRect, oldRect) {
  return newRect.width != oldRect.width || newRect.height != oldRect.height;
}
