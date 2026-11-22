Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    sections: { type: Array, value: [] },
    reasons: { type: Array, value: [] },
    simContext: { type: Object, value: null },
    sim: { type: Object, value: null },
    simLoading: { type: Boolean, value: false },
    simError: { type: String, value: '' },
    sky: { type: Object, value: null },
  },

  data: {
    mode: 'altaz',
  },

  observers: {
    visible(value) {
      if (!value) return
      const hasSim = this.properties.sim && this.properties.sim.frames
      if (!hasSim && this.properties.simContext && !this.properties.simLoading) {
        this.triggerEvent('needsim', this.properties.simContext)
      }
    },
  },

  methods: {
    onClose() { this.triggerEvent('close') },
    noop() {},
    switchMode(e) {
      const mode = e.currentTarget.dataset.mode
      this.setData({ mode })
    },
  },
})
