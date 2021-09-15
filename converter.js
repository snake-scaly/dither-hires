// Copyright (c) 2021 Sergey "SnakE" Gromov.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

const Kr = 0.299
const Kb = 0.114
const Kg = 1 - Kr - Kb

// Whether to convert color sequences like blue-black-blue to blue-blue-blue. Apple connected to an NTSC TV set
// kind of does that. Apple ][ connected to an RGB monitor does that. Agat does not.
let fillColor = true

// Perceptual distance between two RGB colors.
function distance(c1, c2) {
    const dx = (c1[0] - c2[0]) * Kr
    const dy = (c1[1] - c2[1]) * Kg
    const dz = (c1[2] - c2[2]) * Kb
    return dx * dx + dy * dy + dz * dz
}

// Fill colors according to Apple rules.
// colors  - an array of color values. Colors are compared with entries from pal using ===
// pal     - palette
function fill(colors, pal) {
    const result = [...colors]
    for (let i = 1; i < result.length; i++) {
        if (fillColor && i > 1 && colors[i - 1] === pal[0] && colors[i - 2] === colors[i]) {
            result[i - 1] = result[i]
        } else if (colors[i - 1] !== pal[0] && colors[i] !== pal[0]) {
            result[i - 1] = pal[15]
            result[i] = pal[15]
        }
    }
    return result
}

// Render a byte into 7 pixels without considering any interactions between adjacent colors. E.g.
// there can be blue and green adjacent pixels even though in reality both would be white.
// Result never contains white because white is always an interaction between adjacent pixels.
function renderRaw(bits, odd, pal) {
    const shift = (bits & 0x80) >> 7
    const localPal = shift ? [pal[6], pal[9]] : [pal[10], pal[5]]
    const colors = []
    for (let j = 0; j < 7; j++, bits >>= 1, odd = !odd) {
        const bit = bits & 1
        colors.push(bit ? localPal[odd ? 1 : 0] : pal[0])
    }
    return colors
}

// Build a table of all possible Apple septets.
//
// In Apple HGR, each byte represents 7 pixels on the screen. The same byte value can translate
// to different pixel colors depending on whether the byte position in scanline is even or odd.
// This is complicated by the fact that the color of pixels 0 and 7 can depend on contents of
// adjacent bytes. This function builds a table of all possible color combinations that a given
// byte value can produce: the 8 bits of the byte itself, the pixel and its shift bit to the left,
// and the pixel and its shift bit to the right, for both even and odd byte positions. This totals
// to 13 bits of data, or 8192 color combinations.
//
// The structure of the return value is as follows:
//
// result = createLookupTable(pal)
// entry = result[oddity][prevBits][i]
//
// oddity    - 0 for even bytes from the start of the line, 1 for odd
// prevBits  - two most significant bits of the previous byte in the line
// i         - index from 0 to 1023
// entry: {
//   // 7 colors of individual pixels without considering any interactions between adjacent colors. E.g.
//   // there can be blue and green adjacent pixels even though in reality both would be white.
//   // This field never contains white because white is always an interaction between adjacent pixels.
//   raw: [[r, g, b, a], [r, g, b, a], ..., [r, g, b, a]],
//
//   // 7 colors modified according to fill rules. E.g. blue-black-blue in raw pixels will correspond to
//   // blue-blue-blue if colorFill is true. color-color in raw pixels will always correspond to white-white
//   // here. Fill rules take adjacent bytes into account.
//   filled: [[r, g, b, a], [r, g, b, a], ..., [r, g, b, a]],
//
//   // A number between 0 and 255, a native byte representation of the color.
//   bits: Number
// }
function createLookupTable(pal) {
    const result = []
    for (let oddByte = 0; oddByte < 2; oddByte++) {
        const oddVariant = []
        for (let prev = 0; prev < 4; prev++) {
            const prevVariant = []
            for (let bits = 0; bits < 256; bits++) {
                for (let next = 0; next < 4; next++) {
                    const prevRaw = renderRaw(prev << 6, !oddByte, pal)
                    const thisRaw = renderRaw(bits, oddByte, pal)
                    const nextRaw = renderRaw((next & 1) | ((next & 2) << 6), !oddByte, pal)
                    const extendedRaw = [prevRaw[6], ...thisRaw, nextRaw[0]]
                    prevVariant.push({
                        raw: thisRaw,
                        filled: fill(extendedRaw, pal).slice(1, 8),
                        bits: bits
                    })
                }
            }
            oddVariant.push(prevVariant)
        }
        result.push(oddVariant)
    }
    return result
}

// Perceptual color match.
function matchSeptet(pixels, subLookup) {
    let s = subLookup[0]
    let d = Infinity
    for (const septet of subLookup) {
        let d1 = 0
        for (let i = 0; i < 7; i++) {
            d1 += distance(pixels[i], septet.filled[i])
        }
        if (d1 < d) {
            d = d1
            s = septet
        }
    }
    return s
}

function convertLine(colors, lookup, pal) {
    let odd = false
    const line = []
    let prevByte = 0
    for (let pi = 0; pi < colors.length; pi += 7, odd = !odd) {
        const origColors = colors.slice(pi, pi + 7)
        let appleColors = matchSeptet(origColors, lookup[odd ? 1 : 0][prevByte >> 6]);
        line.push(...appleColors.raw)
        prevByte = appleColors.bits
    }
    return fill(line, pal)
}

// Sum of multiple RGBA colors.
function colorSum(...colors) {
    const result = []
    for (let i = 0; i < colors.length; i++) {
        for (let j = 0; j < colors[i].length; j++) {
            if (result[j] === undefined) {
                result[j] = 0
            }
            result[j] += colors[i][j]
        }
    }
    return result
}

// Difference between two RGBA colors.
function colorDiff(rgba1, rgba2) {
    return rgba1.map((c1, i) => c1 - rgba2[i])
}

function colorMul(rgba, factor) {
    return rgba.map(c => c * factor)
}

// Componentwise sum of two sequences of RGBA colors.
function lineSum(line1, line2) {
    return line1.map((c1, i) => colorSum(c1, line2[i]))
}

// Componentwise difference between two sequences of RGBA colors.
function lineDiff(line1, line2) {
    return line1.map((c1, i) => colorDiff(c1, line2[i]))
}

// Diffuse each pixel error between 3 pixels on the next line.
function diffuseError(errors) {
    const straightWeight = 1
    const diagWeight = 1 / Math.sqrt(2)
    const denom = straightWeight + diagWeight * 2
    const straightWeightNorm = straightWeight / denom
    const diagWeightNorm = diagWeight / denom

    const result = new Array(errors.length)
    const extendedErrors = [[0, 0, 0, 0], ...errors, [0, 0, 0, 0]] // to avoid limit checks

    for (let i = 0; i < result.length; i++) {
        result[i] = colorSum(
            colorMul(extendedErrors[i], diagWeightNorm),
            colorMul(extendedErrors[i + 1], straightWeightNorm),
            colorMul(extendedErrors[i + 2], diagWeightNorm))
    }
    return result
}

// Returns a list of lines where each line is a list of [r, g, b, a] pixels.
function convert(colors, width, height, pal) {
    const lookup = createLookupTable(pal)
    const result = [];

    let error = new Array(width)
    error.fill([0, 0, 0, 0])

    for (let li = 0; li < height; li++) {
        const offset = li * width
        const lineColors = colors.slice(offset, offset + width)
        const adjustedColors = lineSum(lineColors, error)
        const convertedColors = convertLine(adjustedColors, lookup, pal)
        result.push(convertedColors);
        // error = lineDiff(adjustedColors, convertedColors)
        error = diffuseError(lineDiff(adjustedColors, convertedColors))
    }
    return result;
}

module.exports = {convert}