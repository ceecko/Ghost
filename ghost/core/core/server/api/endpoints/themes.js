const stripLeadingSlash = s => (s.indexOf('/') === 0 ? s.substring(1) : s);
const dpS3 = require('./dp-s3');
const ObjectID = require('bson-objectid');
const fs = require('fs-extra');
const errors = require('@tryghost/errors');

const themeService = require('../../services/themes');
const limitService = require('../../services/limits');
const models = require('../../models');

// Used to emit theme.uploaded which is used in core/server/analytics-events
const events = require('../../lib/common/events');
const {settingsCache} = require('../../services/settings-helpers');

/** @type {import('@tryghost/api-framework').Controller} */
const controller = {
    docName: 'themes',

    browse: {
        headers: {
            cacheInvalidate: false
        },
        permissions: true,
        query() {
            return themeService.api.getJSON();
        }
    },

    readActive: {
        headers: {
            cacheInvalidate: false
        },
        permissions: true,
        async query() {
            let themeName = settingsCache.get('active_theme');
            const themeErrors = await themeService.api.getThemeErrors(themeName);
            return themeService.api.getJSON(themeName, themeErrors);
        }
    },

    activate: {
        headers: {
            cacheInvalidate: true
        },
        options: [
            'name'
        ],
        validation: {
            options: {
                name: {
                    required: true
                }
            }
        },
        permissions: true,
        async query(frame) {
            let themeName = frame.options.name;

            if (limitService.isLimited('customThemes')) {
                // await limitService.errorIfWouldGoOverLimit('customThemes', {value: themeName});
            }

            const newSettings = [{
                key: 'active_theme',
                value: themeName
            }];

            const themeErrors = await themeService.api.activate(themeName);
            await models.Settings.edit(newSettings, frame.options);
            return themeService.api.getJSON(themeName, themeErrors);
        }
    },

    install: {
        headers: {
            cacheInvalidate: false
        },
        options: [
            'source',
            'ref'
        ],
        validation: {
            options: {
                source: {
                    required: true,
                    values: ['github']
                },
                ref: {
                    required: true
                }
            }
        },
        permissions: {
            method: 'add'
        },
        async query(frame) {
            if (frame.options.source === 'github') {
                const {theme, themeOverridden} = await themeService.api.installFromGithub(frame.options.ref);

                if (themeOverridden) {
                    frame.setHeader('X-Cache-Invalidate', '/*');
                }

                events.emit('theme.uploaded', {name: theme.name});

                return theme;
            }
        }
    },

    upload: {
        headers: {
            cacheInvalidate: false
        },
        permissions: {
            method: 'add'
        },
        async query(frame) {
            if (limitService.isLimited('customThemes')) {
                // Sending a bad string to make sure it fails (empty string isn't valid)
                await limitService.errorIfWouldGoOverLimit('customThemes', {value: '.'});
            }

            // @NOTE: consistent filename uploads
            frame.options.originalname = frame.file.originalname.toLowerCase();

            let zip = {
                path: frame.file.path,
                // Normalizes filename so when Ghost restarts it can find the theme
                name: `${frame.file.originalname.replace(/[^\w@.]/gi, '-')}`
            };

            // Upload theme to S3
            const s3 = dpS3.getS3();
            if (s3 && process.env.APP_ID) {
                const config = {
                    ACL: 'private',
                    Body: fs.createReadStream(zip.path),
                    Bucket: process.env.DP_S3_PATH_BUCKET,
                    CacheControl: `no-store`,
                    Key: stripLeadingSlash(`${process.env.APP_ID}/themes/${zip.name}`)
                };

                await s3.upload(config).promise();
            } else {
                throw new errors.HostLimitError({
                    errorDetails: {
                        name: 'ThemeUploadS3Error'
                    },
                    message: 'Could not upload theme to S3'
                });
            }

            const {theme, themeOverridden} = await themeService.api.setFromZip(zip);
            if (themeOverridden) {
                frame.setHeader('X-Cache-Invalidate', '/*');
            }
            events.emit('theme.uploaded', {name: theme.name});
            return theme;
        }
    },

    download: {
        headers: {
            cacheInvalidate: false
        },
        options: [
            'name'
        ],
        validation: {
            options: {
                name: {
                    required: true
                }
            }
        },
        permissions: {
            method: 'read'
        },
        query(frame) {
            let themeName = frame.options.name;

            return themeService.api.getZip(themeName);
        }
    },

    destroy: {
        statusCode: 204,
        headers: {
            cacheInvalidate: true
        },
        options: [
            'name'
        ],
        validation: {
            options: {
                name: {
                    required: true
                }
            }
        },
        permissions: true,
        async query(frame) {
            let themeName = frame.options.name;

            // Delete theme in S3
            const s3 = dpS3.getS3();
            if (s3 && process.env.APP_ID) {
                const config = {
                    Bucket: process.env.DP_S3_PATH_BUCKET,
                    Key: stripLeadingSlash(`${process.env.APP_ID}/themes/${themeName}.zip`)
                };

                await s3.deleteObject(config).promise();
            } else {
                throw new errors.HostLimitError({
                    errorDetails: {
                        name: 'ThemeDeleteS3Error'
                    },
                    message: 'Could not delete theme in S3'
                });
            }

            return themeService.api.destroy(themeName);
        }
    }
};

module.exports = controller;
