// Copyright (c) 2021 Sergey "SnakE" Gromov.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

const {createCanvas, loadImage, createImageData, ImageData} = require('canvas')
const fs = require('fs')
const fsp = fs.promises
const converter = require('./converter')

function pipeAsync(readable, writable) {
    readable.pipe(writable)
    return new Promise((resolve, reject) => {
        readable.on('error', e => {
            reject(e)
            writable.end()
        })
        writable.on('error', e => {
            reject(e)
            readable.end()
        })
        writable.on('end', () => {
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

async function main() {
    const pal = await loadPaletteAsync('apple2.pal')
    const imgData = await loadImageDataAsync(process.argv[2])
    const result = converter.convert(bytesToColors(imgData.data), imgData.width, imgData.height, pal);
    const resultColors = new Uint8ClampedArray(result.flat().flat());
    const resultData = new ImageData(resultColors, imgData.width, imgData.height)
    await saveImageDataAsync(resultData, process.argv[3])
}

main()
