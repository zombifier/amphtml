/**
 * Copyright 2019 The AMP HTML Authors. All Rights Reserved.
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

import {Action} from '../amp-story-store-service';
import {AmpStory} from '../amp-story';
import {AmpStoryPage} from '../amp-story-page';
import {CommonSignals} from '../../../../src/common-signals';
import {LiveStoryManager} from '../live-story-manager';
import {Services} from '../../../../src/services';
import {addAttributesToElement} from '../../../../src/dom';
import {registerServiceBuilder} from '../../../../src/service';

describes.realWin(
  'LiveStoryManager',
  {
    amp: {
      runtimeOn: true,
      extensions: ['amp-story:1.0'],
    },
  },
  env => {
    let win;
    let liveStoryManager;
    let ampStory;
    let storyEl;

    /**
     * @param {!Element} container
     * @param {number} count
     * @param {Array<string>=} opt_ids
     * @return {!Array<!Element>}
     */
    function createPages(container, count, opt_ids) {
      return Array(count)
        .fill(undefined)
        .map((unused, i) => {
          const page = win.document.createElement('amp-story-page');
          page.id = opt_ids && opt_ids[i] ? opt_ids[i] : `-page-${i}`;
          const storyPage = new AmpStoryPage(page);
          page.getImpl = () => Promise.resolve(storyPage);
          sandbox.stub(storyPage, 'mutateElement').callsFake(fn => fn());
          container.appendChild(page);
          return page;
        });
    }

    beforeEach(() => {
      win = env.win;
      const viewer = Services.viewerForDoc(env.ampdoc);
      sandbox.stub(Services, 'viewerForDoc').returns(viewer);
      sandbox.stub(win.history, 'replaceState');

      registerServiceBuilder(win, 'performance', () => ({
        isPerformanceTrackingOn: () => false,
      }));

      storyEl = win.document.createElement('amp-story');
      win.document.body.appendChild(storyEl);
      addAttributesToElement(storyEl, {
        'id': 'testStory',
        'live-story': '',
      });

      AmpStory.isBrowserSupported = () => true;

      return storyEl.getImpl().then(impl => {
        ampStory = impl;
      });
    });

    afterEach(() => {
      storyEl.remove();
    });

    it('should build a dynamic live-list', () => {
      createPages(ampStory.element, 2, ['cover', 'page-1']);
      liveStoryManager = new LiveStoryManager(ampStory);
      liveStoryManager.build();

      return ampStory
        .layoutCallback()
        .then(() => ampStory.element.signals().signal(CommonSignals.LOAD_END))
        .then(() => {
          const liveListEl = ampStory.element.querySelector('amp-live-list');
          expect(liveListEl).to.exist;
        });
    });

    it('live-list id should equal story id + dymanic-list combo', () => {
      createPages(ampStory.element, 2, ['cover', 'page-1']);
      liveStoryManager = new LiveStoryManager(ampStory);
      liveStoryManager.build();

      return ampStory
        .layoutCallback()
        .then(() => ampStory.element.signals().signal(CommonSignals.LOAD_END))
        .then(() => {
          const liveListEl = ampStory.element.querySelector('amp-live-list');
          expect(liveListEl.id).to.equal(
            'i-amphtml-' + ampStory.element.id + '-dynamic-list'
          );
        });
    });

    it('should throw if no story id is set', () => {
      createPages(ampStory.element, 2, ['cover', 'page-1']);
      liveStoryManager = new LiveStoryManager(ampStory);
      ampStory.element.removeAttribute('id');

      allowConsoleError(() => {
        expect(() => {
          liveStoryManager.build();
        }).to.throw(
          /amp-story must contain id to use the live story functionality/
        );
      });
    });

    it('should append new page from server to client in update', () => {
      createPages(ampStory.element, 2, ['cover', 'page-1']);
      expect(ampStory.element.children.length).to.equal(2);
      liveStoryManager = new LiveStoryManager(ampStory);
      liveStoryManager.build();

      return ampStory
        .layoutCallback()
        .then(() => ampStory.element.signals().signal(CommonSignals.LOAD_END))
        .then(() => {
          const dispatchSpy = sandbox.spy(ampStory.storeService_, 'dispatch');

          const newPage = win.document.createElement('amp-story-page');
          // This would normally get added by AmpLiveList.
          newPage.classList.add('amp-live-list-item-new');
          newPage.id = 'newPage';
          ampStory.element.appendChild(newPage);
          liveStoryManager.update();
          expect(dispatchSpy).to.have.been.calledWith(Action.SET_PAGE_IDS, [
            'cover',
            'page-1',
            'newPage',
          ]);
        });
    });
  }
);
