const stripLeadingSlash = s => (s.indexOf('/') === 0 ? s.substring(1) : s);
const dpS3 = require('./dp-s3');
const ObjectID = require('bson-objectid');

const fs = require('fs-extra');
const themeService = require('../../services/themes');
const limitService = require('../../services/limits');
const models = require('../../models');
const errors = require('@tryghost/errors/lib/errors');

// Used to emit theme.uploaded which is used in core/server/analytics-events
const events = require('../../lib/common/events');

module.exports = {
    docName: 'themes',

    browse: {
        permissions: true,
        query() {
            return themeService.api.getJSON();
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

            return themeService.api.activate(themeName)
                .then((checkedTheme) => {
                    // @NOTE: we use the model, not the API here, as we don't want to trigger permissions
                    return models.Settings.edit(newSettings, frame.options)
                        .then(() => checkedTheme);
                })
                .then((checkedTheme) => {
                    return themeService.api.getJSON(themeName, checkedTheme);
                });
        }
    },

    install: {
        headers: {},
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
                    this.headers.cacheInvalidate = true;
                }

                events.emit('theme.uploaded', {name: theme.name});

                return theme;
            }
        }
    },

    upload: {
        headers: {},
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
                name: `${ObjectID()}_${frame.file.originalname}`
            };

            // Upload theme to S3
            const s3 = dpS3.getS3();
            if (s3 && process.env.APP_ID) {
                const config = {
                    ACL: 'private',
                    Body: fs.createReadStream(zip.path),
                    Bucket: process.env.GHOST_STORAGE_ADAPTER_S3_PATH_BUCKET,
                    CacheControl: `no-store`,
                    Key: stripLeadingSlash(`${process.env.APP_ID}/themes/${zip.name}`)
                };

                await s3.upload(config).promise();
            } else {
                const errorObj = {
                    errorDetails: {
                        name: 'ThemeUploadS3Error'
                    },
                    message: 'Could not upload theme to S3'
                };

                throw new errors.HostLimitError(errorObj);
            }

            return themeService.api.setFromZip(zip)
                .then(({theme, themeOverridden}) => {
                    if (themeOverridden) {
                        // CASE: clear cache
                        this.headers.cacheInvalidate = true;
                    }
                    events.emit('theme.uploaded', {name: theme.name});
                    return theme;
                });
        }
    },

    download: {
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
                    Bucket: process.env.GHOST_STORAGE_ADAPTER_S3_PATH_BUCKET,
                    Key: stripLeadingSlash(`${process.env.APP_ID}/themes/${themeName}.zip`)
                };

                await s3.deleteObject(config).promise();
            } else {
                const errorObj = {
                    errorDetails: {
                        name: 'ThemeDeleteS3Error'
                    },
                    message: 'Could not delete theme in S3'
                };

                throw new errors.HostLimitError(errorObj);
            }

            return themeService.api.destroy(themeName);
        }
    }
};
