L.WindyLayer = (L.Layer ? L.Layer : L.Class).extend({

    options: {
    },

    _map: null,
    _canvasLayer: null,
    _windy: null,

    initialize: function(options) {
        L.setOptions(this, options);
    },

    onAdd: function(map) {
        // create canvas, add overlay control
        this._canvasLayer = L.canvasLayer().delegate(this);
        this._canvasLayer.addTo(map);
        this._map = map;
    },

    onRemove: function(map) {
        this._destroyWind();
    },

    setData: function setData(data) {
        this.options.data = data;

        if (this._windy) {
            this._windy.setData(data);
        }

        return this;
    },

    /*------------------------------------ PRIVATE ------------------------------------------*/

    onDrawLayer: function(params) {
        if (this._windy) {
            this._windy = this._windy.release()
        }

        this._windy = new Windy(
            params.canvas,
            [
                [0, 0],
                [params.size.x, params.size.y]
            ],
            params.size.x,
            params.size.y,
            [
                [params.bounds._southWest.lng, params.bounds._southWest.lat],
                [params.bounds._northEast.lng, params.bounds._northEast.lat]
            ],
            this.options
        )

        if (this.options.data) {
            this._windy.setData(this.options.data);
        }
        this._windy.start();
    },

    _destroyWind: function() {
        if (this._windy) {
            this._windy = this._windy.release()
        }
        this._canvasLayer.clear()
        this._map.removeLayer(this._canvasLayer)
        this._canvasLayer = null
    }
});

L.windyLayer = function(options) {
    return new L.WindyLayer(options);
};