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

import {
  nativeIntersectionObserverSupported,
} from '../../src/intersection-observer-polyfill';
import sleep from 'sleep-promise';
import {
  RequestBank
} from '../../testing/test-helper';
import {
  createFixtureIframe
} from '../../testing/iframe';

const adBody = __html__['test/fixtures/amp-inabox.html']
.replace('__VIEW_URL__', RequestBank.getUrl('view'))
.replace('__ACTIVE_VIEW_URL__', RequestBank.getUrl('activeview'));

describes.realWin('AMP Ad Inabox', {amp: false}, function(env) {
  this.timeout(0);
  let win;
  let doc;
  let iframe;
  let script;
  beforeEach(() => {
    win = env.win;
    doc = win.document;
    script = document.createElement('script');
    script.src = '/examples/inabox-tag-integration.js';
    doc.body.appendChild(script);
    iframe = document.createElement('iframe');
    doc.body.appendChild(iframe);
    iframe.contentDocument.write(adBody);
    iframe.contentDocument.close();
  });

  afterEach(() => {
    doc.body.removeChild(iframe);
    doc.body.removeChild(script);
  });

  it('should have activeview ping about 1 second after view ping', function() {
    var activeViewDone = false;
    RequestBank.withdraw('activeview').then(() => {
      activeViewDone = true;
    });
    return RequestBank.withdraw('view').then(() => {
      expect(activeViewDone).to.be.false;
    })
    .then(sleep(1300))
    .then(() => {
      expect(activeViewDone).to.be.true;
    });
  });
});

describes.realWin('AMP Ad SafeFrame', {amp: false}, function(env) {
  this.timeout(0);
  let iframe;
  let win;
  let doc;
  beforeEach(() => {
    win = env.win;
    doc = win.document;
    iframe = document.createElement('iframe');
    iframe.name = `1;${adBody.length};${adBody}{"uid": "test"}`
    iframe.src = "http://tpc.googlesyndication.com/safeframe/1-0-31/html/container.html";
    doc.body.appendChild(iframe);
  });

  afterEach(() => {
    doc.body.removeChild(iframe);
  });
  it('should have activeview ping about 1 second after view ping', function() {
    var activeViewDone = false;
    RequestBank.withdraw('activeview').then(() => {
      activeViewDone = true;
    });
    return RequestBank.withdraw('view').then(() => {
      expect(activeViewDone).to.be.false;
    })
    .then(sleep(1300))
    .then(() => {
      expect(activeViewDone).to.be.true;
    });
  });
});
