/**
 * Copyright 2018 The AMP HTML Authors. All Rights Reserved.
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
'use strict';

const sleep = require('sleep-promise');
const {verifyCssElements} = require('../../../build-system/tasks/visual-diff/helpers');

module.exports = {
  'scroll down to view second ad': async (page, name) => {
    await page.hover('#div-gpt-ad-1542810129742-0');
    await verifyCssElements(page, name,
      /* forbiddenCss */ null,
      /* loadingIncompleteCss */ null,
      /* loadingCompleteCss */ ['.second-impression-viewable']);
  },

};
