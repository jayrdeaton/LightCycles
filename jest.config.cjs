// maxWorkers capped — Jest's own default (CPUs - 1) reliably triggers "A worker process has
// failed to exit gracefully" on this machine, where several concurrent dev sessions already
// contend for the same cores; --detectOpenHandles (which runs in-band) finds no real leak, and
// maxWorkers=1 alone makes the warning disappear, confirming it's worker-shutdown starvation
// under CPU contention, not a leaked timer/handle in this repo's code.
module.exports = require('@infinitetoken/jest-config/expo')({ overrides: { maxWorkers: '50%' } })
