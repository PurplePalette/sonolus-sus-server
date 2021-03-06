import { Readable } from 'stream'
import { gzip } from 'zlib'
import { Response } from 'express'
import {
    GetObjectCommand,
    GetObjectCommandOutput,
    S3Client,
} from '@aws-sdk/client-s3'

import { bucket, S3Error } from './constants'
import { fromSus } from 'sonolus-pjsekai-engine'
import { LevelData } from 'sonolus-core'

export function gzipPromise(data: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        gzip(data, (err, result) => {
            if (err) {
                reject(err)
            }
            resolve(result)
        })
    })
}

export function streamToString(stream: Readable): Promise<string> {
    const chunks: Buffer[] = []
    return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        stream.on('error', (err) => reject(err))
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
}

export async function getSusData(
    s3: S3Client,
    hash: string,
    res: Response
): Promise<LevelData | undefined> {
    let content: GetObjectCommandOutput
    try {
        content = await s3.send(
            new GetObjectCommand({
                Bucket: bucket,
                Key: `SusFile/${hash}`,
            })
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
        switch (e.Code) {
            case 'NoSuchKey':
                console.log(`No such key: SusFile/${hash}`)
                res.status(404).json({
                    error: 'File not found',
                    code: 'file_not_found',
                })
                break
            default:
                if (isS3Error(e)) {
                    const err: S3Error = e
                    console.log(
                        `S3 GetObject Error: ${err.$metadata.httpStatusCode} / ${err.Code}`
                    )
                } else {
                    console.log(`Unknown error while getting file: ${e}`)
                }
                res.status(500).json({
                    error: 'Internal Server Error',
                    code: 'internal_server_error',
                })
                break
        }
        return
    }
    const body = content.Body as Readable
    let data: LevelData
    try {
        data = fromSus(await streamToString(body))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
        console.log(`Error while parsing SUS file: ${e}`)
        if (e.message.includes('Unexpected missing bar')) {
            res.status(400).json({
                error: 'Unexpected missing bar',
                code: 'unexpected_missing_bar',
            })
            return
        }
        res.status(500).json({
            error: 'Internal Server Error',
            code: 'internal_server_error',
        })
        return
    }
    return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isS3Error = (d: any): d is S3Error => {
    if (!d) return false
    if (
        d.Code &&
        typeof d.Code === 'string' &&
        d.$metadata &&
        typeof d.$metadata === 'object'
    ) {
        if (typeof d.$metadata.httpStatusCode === 'number') {
            return true
        }
    }
    return false
}
