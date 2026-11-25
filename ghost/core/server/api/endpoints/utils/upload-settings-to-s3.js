const { HostLimitError } = require('@tryghost/errors');
const dpS3 = require('../dp-s3');

module.exports = async function uploadSettingsToS3(filePath, content) {
  const s3 = dpS3.getS3();

  if (!s3 || !process.env.APP_ID || !process.env.DP_S3_PATH_BUCKET) {
    throw new HostLimitError({
      errorDetails: {
        name: 'SettingsUploadS3Error',
      },
      message: `Could not upload ${filePath} to S3`,
    });
  }

  await s3
    .upload({
      ACL: 'private',
      Body: content,
      Bucket: process.env.DP_S3_PATH_BUCKET,
      CacheControl: 'no-store',
      ContentType: 'application/yaml; charset=utf-8',
      Key: `${process.env.APP_ID}/${filePath}`.replace(/^\/+/, ''),
    })
    .promise();
};
