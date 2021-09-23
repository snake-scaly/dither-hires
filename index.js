// Copyright (c) 2021 Sergey "SnakE" Gromov.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

const {createCanvas, loadImage, createImageData, ImageData} = require('canvas')
const fs = require('fs')
const fsp = fs.promises
const converter = require('./converter')

// Name "APPLE" and some metadata.
const filHeader = [
    0xc1, 0xd0, 0xd0, 0xcc, 0xc5, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0,
    0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0xa0, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x84, 0x00, 0x20, 0xff, 0x1f
]

function pipeAsync(readable, writable) {
    readable.pipe(writable)
    return new Promise((resolve, reject) => {
        readable.on('error', e => {
            console.error(e)
            reject(e)
            writable.end()
        })
        writable.on('error', e => {
            console.error(e)
            reject(e)
            readable.end()
        })
        readable.on('end', () => {
            resolve()
        })
    })
}

async function loadImageDataAsync(name) {
    const img = await loadImage(name)
    const canvas = createCanvas(img.width, img.height)
    const context = canvas.getContext('2d')
    context.drawImage(img, 0, 0)
    return context.getImageData(0, 0, img.width, img.height)
}

async function saveImageDataAsync(data, name) {
    const canvas = createCanvas(data.width, data.height)
    const context = canvas.getContext('2d')
    context.putImageData(data, 0, 0)
    const pngStream = canvas.createPNGStream()
    const out = fs.createWriteStream(name)
    await pipeAsync(pngStream, out)
}

async function loadPaletteAsync(name) {
    const palFile = await fsp.readFile(name, 'utf8')
    const lines = palFile.split('\r\n').filter(l => l)
    return lines.map(l => [...l.split('\t'), 255])
}

// Convert bytes to a sequence of 4-element arrays.
function bytesToColors(bytes) {
    function* gen(bytes) {
        for (let i = 0; i < bytes.length; i += 4) {
            yield [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]
        }
    }
    return Array.from(gen(bytes))
}

// Arrange image lines according to Apple in-memory format and prepend the FIL header.
function createAppleFil(bytes) {
    const fil = new Uint8ClampedArray(0x2000 + filHeader.length)
    fil.set(filHeader)
    const imageData = fil.subarray(filHeader.length)

    for (let rasterLine = 0; rasterLine < 8; rasterLine++) {
        let rasterOffset = rasterLine * 128 * 8
        for (let charLine = 0; charLine < 8; charLine++) {
            let charOffset = rasterOffset + charLine * 128
            for (let superblock = 0; superblock < 3; superblock++) {
                let offset = charOffset + superblock * 40
                let line_index = superblock * 64 + charLine * 8 + rasterLine
                imageData.set(bytes[line_index], offset)
            }
        }
    }

    return fil
}

async function main() {
    const pal = await loadPaletteAsync('apple2.pal')
    const imgData = await loadImageDataAsync(process.argv[2])

    const {colors: resultColors, bytes: resultBytes} =
        converter.convert(bytesToColors(imgData.data), imgData.width, imgData.height, pal);

    const colorArray = new Uint8ClampedArray(resultColors.flat().flat());
    const colorData = new ImageData(colorArray, imgData.width, imgData.height)
    await saveImageDataAsync(colorData, `${process.argv[3]}.png`)

    const filData = createAppleFil(resultBytes)
    await fsp.writeFile(`${process.argv[3]}.fil`, filData)
}

main()
