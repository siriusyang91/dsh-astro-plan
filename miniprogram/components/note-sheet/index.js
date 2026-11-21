Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    sections: { type: Array, value: [] },
    reasons: { type: Array, value: [] },
  },
  methods: {
    onClose() { this.triggerEvent('close') },
    noop() {},
  },
})
