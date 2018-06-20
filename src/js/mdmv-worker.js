
const NULL_VECTOR = [NaN, NaN, null]


class MDMV {
    constructor() {
    }

    static buildBounds(bounds, width, height) {
        var upperLeft = bounds[0]
        var lowerRight = bounds[1]
        var x = Math.round(upperLeft[0])
        var y = Math.max(Math.floor(upperLeft[1], 0), 0)
        var xMax = Math.min(Math.ceil(lowerRight[0], width), width - 1)
        var yMax = Math.min(Math.ceil(lowerRight[1], height), height - 1)
        return {x: x, y: y, xMax: width, yMax: yMax, width: width, height: height}
    }

    static deg2rad(deg) {
        return (deg / 180) * Math.PI;
    }

    static rad2deg(ang) {
        return ang / (Math.PI/180.0);
    }

    static invert(x, y, extent) {
        var mapLonDelta = extent.east - extent.west
        var worldMapRadius = extent.width / MDMV.rad2deg(mapLonDelta) * 360/(2 * Math.PI)
        var mapOffsetY = ( worldMapRadius / 2 * Math.log( (1 + Math.sin(extent.south) ) / (1 - Math.sin(extent.south)) ))
        var equatorY = extent.height + mapOffsetY
        var a = (equatorY - y) / worldMapRadius

        var lat = 180/Math.PI * (2 * Math.atan(Math.exp(a)) - Math.PI/2)
        var lon = MDMV.rad2deg(extent.west) + x / extent.width * MDMV.rad2deg(mapLonDelta)
        return [lon, lat]
    }

    static mercY(lat) {
        return Math.log( Math.tan( lat / 2 + Math.PI / 4 ) )
    }

    static project(lat, lon, extent) {
        // both in radians, use deg2rad if neccessary
        var ymin = MDMV.mercY(extent.south)
        var ymax = MDMV.mercY(extent.north)
        var xFactor = extent.width / ( extent.east - extent.west )
        var yFactor = extent.height / ( ymax - ymin )

        var y = MDMV.mercY( MDMV.deg2rad(lat) )
        var x = (MDMV.deg2rad(lon) - extent.west) * xFactor
        var y = (ymax - y) * yFactor // y points south
        return [x, y]
    }

    /**
     * @returns {Boolean} true if the specified value is not null and not undefined.
     */
    static isValue(x) {
        return x !== null && x !== undefined
    }

    /**
     * @returns {Number} returns remainder of floored division, i.e., floor(a / n). Useful for consistent modulo
     *          of negative numbers. See http://en.wikipedia.org/wiki/Modulo_operation.
     */
    static floorMod(a, n) {
        return a - n * Math.floor(a / n)
    }

    /**
     * @returns {Number} the value x clamped to the range [low, high].
     */
    static clamp(x, range) {
        return Math.max(range[0], Math.min(x, range[1]))
    }

    /**
     * @returns {Boolean} true if agent is probably a mobile device. Don't really care if this is accurate.
     */
    static isMobile() {
        return (/android|blackberry|iemobile|ipad|iphone|ipod|opera mini|webos/i).test(navigator.userAgent);
    }

    /**
     * Calculate distortion of the wind vector caused by the shape of the projection at point (x, y). The wind
     * vector is modified in place and returned by this function.
     */
    static distort(projection, lo, la, x, y, scale, wind, windy) {
        var u = wind[0] * scale
        var v = wind[1] * scale
        var d = MDMV.distortion(projection, lo, la, x, y, windy)

        // Scale distortion vectors by u and v, then add.
        wind[0] = d[0] * u + d[2] * v
        wind[1] = d[1] * u + d[3] * v
        return wind
    }

    static distortion(projection, λ, φ, x, y, windy) {
        var τ = 2 * Math.PI
        var H = Math.pow(10, -5.2)
        var hλ = λ < 0 ? H : -H
        var hφ = φ < 0 ? H : -H

        var pλ = MDMV.project(φ, λ + hλ,windy)
        var pφ = MDMV.project(φ + hφ, λ, windy)

        // Meridian scale factor (see Snyder, equation 4-3), where R = 1. This handles issue where length of 1º λ
        // changes depending on φ. Without this, there is a pinching effect at the poles.
        var k = Math.cos(φ / 360 * τ)
        return [
            (pλ[0] - x) / hλ / k,
            (pλ[1] - y) / hλ / k,
            (pφ[0] - x) / hφ,
            (pφ[1] - y) / hφ
        ]
    }

    // interpolation for vectors like wind (u,v,m)
    static bilinearInterpolateVector(x, y, g00, g10, g01, g11) {
        var rx = (1 - x)
        var ry = (1 - y)
        var a = rx * ry,  b = x * ry,  c = rx * y,  d = x * y
        var u = g00[0] * a + g10[0] * b + g01[0] * c + g11[0] * d
        var v = g00[1] * a + g10[1] * b + g01[1] * c + g11[1] * d
        return [u, v, Math.sqrt(u * u + v * v)]
    }


    /**
     * Get interpolated grid value from Lon/Lat position
     * @param λ {Float} Longitude
     * @param φ {Float} Latitude
     * @returns {Object}
     */
    static interpolate(header, grid, λ, φ) {
        if(!grid) return null;

        // calculate longitude index in wrapped range [0, 360)
        var i = MDMV.floorMod(λ - header.lo1, 360) / header.dx;
        // calculate latitude index in direction +90 to -90
        var j = (header.la1 - φ) / header.dy;

        var fi = Math.floor(i), ci = fi + 1;
        var fj = Math.floor(j), cj = fj + 1;

        var row;
        if ((row = grid[fj])) {
            var g00 = row[fi];
            var g10 = row[ci];
            if (MDMV.isValue(g00) && MDMV.isValue(g10) && (row = grid[cj])) {
                var g01 = row[fi];
                var g11 = row[ci];
                if (MDMV.isValue(g01) && MDMV.isValue(g11)) {
                    // All four points found, so interpolate the value.
                    return MDMV.bilinearInterpolateVector(i - fi, j - fj, g00, g10, g01, g11);
                }
            }
        }
        return null;
    }

    static interpolateField(vscale, header, grid, bounds, extent) {
        var projection = {}
        var mapArea = ((extent.south - extent.north) * (extent.west - extent.east))
        var velocityScale = vscale * Math.pow(mapArea, 0.4)

        var columns = []
        var x = bounds.x

        function interpolateColumn(x) {
            var column = []
            for (let y = bounds.y; y <= bounds.yMax; y += 2) {
                let coord = MDMV.invert( x, y, extent )
                if (coord) {
                    let lo = coord[0], la = coord[1]
                    if (isFinite(lo)) {
                        let wind = MDMV.interpolate(header, grid, lo, la)
                        if (wind) {
                            wind = MDMV.distort(projection, lo, la, x, y, velocityScale, wind, extent)
                            column[y+1] = column[y] = wind
                        }
                    }
                }
            }
            columns[x+1] = columns[x] = column
        }

        while (x < bounds.width) {
            interpolateColumn(x)
            x += 2
        }

        return columns
    }

    static gridPoint(data, p) {
        return [data[0][p], data[1][p]]
    }

    static createField(columns, bounds) {
        /**
         * @returns {Array} wind vector [u, v, magnitude] at the point (x, y), or [NaN, NaN, null] if wind
         *          is undefined at that point.
         */
        function field(x, y) {
            var column = columns[Math.round(x)]
            return column && column[Math.round(y)] || NULL_VECTOR
        }

        // Frees the massive "columns" array for GC. Without this, the array is leaked (in Chrome) each time a new
        // field is interpolated because the field closure's context is leaked, for reasons that defy explanation.
        field.release = function() {
            columns = []
        }

        field.randomize = function(o) {  // UNDONE: this method is terrible
            var x, y
            var safetyNet = 0
            do {
                x = Math.round(Math.floor(Math.random() * bounds.width) + bounds.x)
                y = Math.round(Math.floor(Math.random() * bounds.height) + bounds.y)
            } while (field(x, y)[2] === null && safetyNet++ < 30)
            o.x = o.ox = x
            o.y = o.oy = y
            return o
        }

        return field
    }

    static buildFieldColumns(header, data, vscale, canvasBound, mapBounds) {
        let grid = [], p = 0
        let isContinuous = Math.floor(header.nx * header.dx) >= 360
        for (let j = 0; j < header.ny; j++) {
            let row = []
            for (let i = 0; i < header.nx; i++, p++) {
                row[i] = MDMV.gridPoint(data, p)
            }
            if (isContinuous) {
                row.push(row[0])
            }
            grid[j] = row
        }

        return MDMV.interpolateField(
            vscale,
            header,
            grid,
            canvasBound,
            mapBounds
        )
    }
}


onmessage = function(e) {
    let columns = MDMV.buildFieldColumns(
        e.data.header, e.data.data, e.data.vscale,
        e.data.canvasBound, e.data.mapBounds
    )
    postMessage({ columns: columns });
};
