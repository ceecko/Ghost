const fs = require('fs-extra');
const uploadSettingsToS3 = require('./utils/upload-settings-to-s3');

const customRedirects = require('../../services/custom-redirects');
const {
  parseJson,
  parseYaml,
  serializeToYaml,
} = require('../../services/custom-redirects/redirect-config-parser');

/** @type {import('@tryghost/api-framework').Controller} */
const controller = {
  docName: 'redirects',

  download: {
    headers: {
      disposition: {
        type: 'yaml',
        value: 'redirects.yaml',
      },
      cacheInvalidate: false,
    },
    permissions: true,
    response: {
      format: () => 'plain',
    },
    async query() {
      const redirects = await customRedirects.api.getAll();
      return serializeToYaml(redirects);
    },
  },

  upload: {
    permissions: true,
    headers: {
      cacheInvalidate: true,
    },
    async query(frame) {
      const content = await fs.readFile(frame.file.path, 'utf-8');
      const redirects = frame.file.ext === '.yaml' ? parseYaml(content) : parseJson(content);
      await customRedirects.api.replace(redirects);
      await uploadSettingsToS3(
        'settings/redirects.yaml',
        frame.file.ext === '.yaml' ? content : serializeToYaml(redirects),
      );
    },
  },
};

module.exports = controller;
