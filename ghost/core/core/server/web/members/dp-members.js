const errors = require('@tryghost/errors');

const self = {
    canSendMagicLink: async (req, res, next) => {
        try {
            const appId = process.env.APP_ID
            const ghostApiUrl = process.env.GHOST_API_URL
            const secretKey = process.env.GHOST_API_SECRET_KEY

            if(typeof req.body?.email !== 'string') {
                return next()
            }

            const email = req.body.email.trim()

            const apiUrl = `${ghostApiUrl}/api/blog/${appId}/new-member-validation`
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-GhostBlog-Auth': `${secretKey}`
                },
                body: JSON.stringify({
                    email: email,
                    headers: req.headers,
                })
            })

            const data = await response.json()

            if (data?.allow !== true) {
                // return next(new errors.TooManyRequestsError({
                //     message: `Too many different subscribe attempts, try again later`,
                //     context: 'Too many attempts',
                //     help: 'Too many attempts'
                // }))
            }

            next()
        } catch (err) {
            console.error('Error in canSendMagicLink')
            console.trace(err)

            next()
        }
    },
}

module.exports = self
