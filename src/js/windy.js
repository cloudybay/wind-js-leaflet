
class Windy extends MDMV {

	constructor(canvas, bounds, width, height, extent, options) {
		super()

		// velocity at which particle intensity is minimum (m/s)
		this.MIN_VELOCITY_INTENSITY = (options && options.minVelocity) || 0
		// velocity at which particle intensity is maximum (m/s)
		this.MAX_VELOCITY_INTENSITY = (options && options.maxVelocity) || 26
		// scale for wind velocity (completely arbitrary--this value looks nice)
		this.VELOCITY_SCALE = ((options && options.velocityScale) || 0.015) * (Math.pow(window.devicePixelRatio,1/3) || 1)
		// max number of frames a particle is drawn before regeneration
		this.MAX_PARTICLE_AGE = (options && options.particleAge) || 90
		// line width of a drawn particle
		this.PARTICLE_LINE_WIDTH = (options && options.lineWidth) || 1
		// particle count scalar (completely arbitrary--this values looks nice)
		this.PARTICLE_MULTIPLIER = (options && options.particleMultiplier) || 1 / 600
		// desired frames per second
		this.FRAME_RATE = (options && options.frameRate) || 30
		this.FRAME_TIME = 1000 / this.FRAME_RATE

		// multiply particle count for mobiles by this amount
		this.PARTICLE_REDUCTION = (Math.pow(window.devicePixelRatio,1/3) || 1.6)

		this.colorScale = (options && options.colorScale) || [
			"rgb(36,104,180)",
			"rgb(60,157,194)",
			"rgb(128,205,193)",
			"rgb(151,218,168)",
			"rgb(198,231,181)",
			"rgb(238,247,217)",
			"rgb(255,238,159)",
			"rgb(252,217,125)",
			"rgb(255,182,100)",
			"rgb(252,150,75)",
			"rgb(250,112,52)",
			"rgb(245,64,32)",
			"rgb(237,45,28)",
			"rgb(220,24,32)",
			"rgb(180,0,35)"
		]

		this.canvas = canvas
		this.canvasBound = Windy.buildBounds(bounds, width, height)
		this.mapBounds = {
			south: Windy.deg2rad(extent[0][1]),
			north: Windy.deg2rad(extent[1][1]),
			east: Windy.deg2rad(extent[1][0]),
			west: Windy.deg2rad(extent[0][0]),
			width: width,
			height: height
		}

		// -1: stop, 0: waiting field ready, 1: running
		this.running_flag = -1
		this.data_lock = 0
		this._timer_prepare_columns = null
		this._timer_prepare_animate = null
		this._animationLoop = null

		if (options.worker_uri) {
			var self = this
			self.worker = new Worker(options.worker_uri);
			self.worker.onmessage = function (e) {
				self.data_lock = 0
				let columns = e.data.columns
				let field = Windy.createField(columns, self.canvasBound)
				if (self.field) {
					self.field = self.field.release()
				}
				self.field = field
			}
		}
	}

	setData(gridData) {
		var self = this
		if (gridData.header && gridData.data) {
			if (self.worker) {
				(function prepare_columns() {
					if (self.data_lock == 0) {
						self.data_lock = 1
						self.gridData = gridData
						self.worker.postMessage({
							header: gridData.header,
							data: gridData.data,
							vscale: self.VELOCITY_SCALE,
							canvasBound: self.canvasBound,
							mapBounds: self.mapBounds
						})
					}
					else {
						self._timer_prepare_columns = setTimeout(prepare_columns, 100)
					}
				})();
			}
			else {
				self.gridData = gridData
				let columns = Windy.buildFieldColumns(
					gridData.header, gridData.data, self.VELOCITY_SCALE,
					self.canvasBound, self.mapBounds
				)
				let field = Windy.createField(columns, self.canvasBound)
				if (self.field) {
					self.field = self.field.release()
				}
				self.field = field
			}
		}
		else {
			self.gridData = gridData
			if (self.field) {
				self.field = self.field.release()
			}
		}
		return self
	}

	animate() {
		if (!this.field) { return }
		var self = this
		function windIntensityColorScale() {
			if (!self.colorScale.indexFor) {
				let min = self.MIN_VELOCITY_INTENSITY,
					max = self.MAX_VELOCITY_INTENSITY
				self.colorScale.indexFor = function (m) {
					// map velocity speed to a style
					return Math.max(0, Math.min((self.colorScale.length - 1),
						Math.round((m - min) / (max - min) * (self.colorScale.length - 1))))

				}
			}
			return self.colorScale
		}

		var colorStyles = windIntensityColorScale()
		var buckets = colorStyles.map(function() { return [] })

		var particleCount = Math.round(self.canvasBound.width * self.canvasBound.height * self.PARTICLE_MULTIPLIER)
		if (Windy.isMobile()) {
			particleCount *= PARTICLE_REDUCTION
		}

		var fadeFillStyle = "rgba(0, 0, 0, 0.97)"

		var particles = []
		for (var i = 0; i < particleCount; i++) {
			particles.push(self.field.randomize({age: Math.floor(Math.random() * self.MAX_PARTICLE_AGE) + 0}))
		}
		var over_part_count = 0

		function evolve() {
			buckets.forEach(function(bucket) { bucket.length = 0 })
			particles.forEach(function(particle) {
				if (particle.age > self.MAX_PARTICLE_AGE) {
					self.field.randomize(particle).age = 0
					over_part_count ++
					if (over_part_count >= particleCount) {
						over_part_count = 0
					}
				}
				var x = particle.x
				var y = particle.y
				var v = self.field(x, y)
				var m = v[2]
				if (m === null) {
					// particle has escaped the grid, never to return...
					particle.age = self.MAX_PARTICLE_AGE
				}
				else {
					var xt = x + v[0]
					var yt = y + v[1]
					if (self.field(xt, yt)[2] !== null) {
						// Path from (x,y) to (xt,yt) is visible, so add this particle to the appropriate draw bucket.
						particle.xt = xt
						particle.yt = yt
						buckets[colorStyles.indexFor(m)].push(particle)
					}
					else {
						// Particle isn't visible, but it still moves through the field.
						particle.x = xt
						particle.y = yt
					}
				}
				particle.age += 1
			})
		}

		var g = this.canvas.getContext("2d")
		g.lineWidth = self.PARTICLE_LINE_WIDTH
		g.fillStyle = fadeFillStyle
		g.globalAlpha = 0.6

		function draw() {
			// Fade existing particle trails.
			var prev = "lighter"
			g.globalCompositeOperation = "destination-in"
			g.fillRect(self.canvasBound.x, self.canvasBound.y, self.canvasBound.width, self.canvasBound.height)
			g.globalCompositeOperation = prev
			g.globalAlpha = 0.9

			// Draw new particle trails.
			buckets.forEach(function(bucket, i) {
				if (bucket.length > 0) {
					g.beginPath()
					g.strokeStyle = colorStyles[i]
					bucket.forEach(function(particle) {
						g.moveTo(particle.x, particle.y)
						g.lineTo(particle.xt, particle.yt)
						particle.x = particle.xt
						particle.y = particle.yt
					})
					g.stroke()
				}
			})
		}

		var then = new Date;
		(function frame() {
			self._animationLoop = requestAnimationFrame(frame)
			var now = new Date
			var delta = now - then
			if (delta > self.FRAME_TIME) {
				then = now - (delta % self.FRAME_TIME)
				evolve()
				draw()
			}
		})()
	}

	start() {
		var self = this
		if (self.running_flag == -1) {
			self.running_flag = 0;
			(function prepare_animate() {
				if (self.field) {
					if (self._animationLoop) {
						cancelAnimationFrame(self._animationLoop)
						self._animationLoop = null
					}
					self.running_flag = 1
					self.animate()
				}
				else if (self.running_flag == 0) {
					self._timer_prepare_animate = setTimeout(prepare_animate, 100)
				}
			}())
		}
		return self
	}

	stop() {
		this.running_flag = -1
		if (this._timer_prepare_animate) {
			clearTimeout(this._timer_prepare_animate)
			this._timer_prepare_animate = null
		}
		if (this._animationLoop) {
			cancelAnimationFrame(this._animationLoop)
			this._animationLoop = null
		}
		return this
	}

	release() {
		this.stop()
		if (this._timer_prepare_columns) {
			clearTimeout(this._timer_prepare_columns)
			this._timer_prepare_columns = null
		}
		if (this.field) {
			this.field = this.field.release()
		}
		return null
	}
}
