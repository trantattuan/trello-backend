import fp from 'fastify-plugin'
import { FastifyInstance } from 'fastify'
import { Client } from 'minio'

declare module 'fastify' {
  interface FastifyInstance {
    minio: Client
  }
}

const BUCKETS = ['attachments', 'avatars', 'backgrounds']

export default fp(async (app: FastifyInstance) => {
  const client = new Client({
    endPoint: process.env.MINIO_ENDPOINT!,
    port: parseInt(process.env.MINIO_PORT || '9000'),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ROOT_USER!,
    secretKey: process.env.MINIO_ROOT_PASSWORD!,
  })

  for (const bucket of BUCKETS) {
    const exists = await client.bucketExists(bucket)
    if (!exists) {
      await client.makeBucket(bucket)
      if (bucket !== 'attachments') {
        await client.setBucketPolicy(bucket, JSON.stringify({
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `arn:aws:s3:::${bucket}/*` }],
        }))
      }
    }
  }

  app.decorate('minio', client)
})
