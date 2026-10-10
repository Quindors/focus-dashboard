// One dashboard tab per browser.
//
// The monitor brings the dashboard forward on session and break transitions
// (monitor/browser.py). From outside the browser it cannot raise a background
// tab, so it opens a fresh one — which would leave a tab behind per
// transition. Instead every dashboard tab announces itself here, and an older
// tab bows out when it hears a newer one. Chrome lets a page close itself
// only while it has a single history entry, which a dashboard tab opened by
// URL has; anywhere else this is a harmless no-op.
const CHANNEL = 'cft-dashboard'

export function claimSingleTab() {
  if (typeof BroadcastChannel === 'undefined') return
  const me = { id: Math.random().toString(36).slice(2), born: Date.now() }
  const bc = new BroadcastChannel(CHANNEL)
  bc.onmessage = ({ data }) => {
    if (!data || data.id === me.id) return
    const newer = data.born > me.born || (data.born === me.born && data.id > me.id)
    if (newer) {
      bc.close()
      window.close()
    }
  }
  bc.postMessage(me)
}
