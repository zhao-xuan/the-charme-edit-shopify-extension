import { Component } from 'react'

export function CustomizerErrorFallback() {
  return (
    <main className="customizer-error" role="alert">
      <strong>We couldn’t display the customizer.</strong>
      <span>Your design is still safe. Reload the tool to continue.</span>
      <button type="button" onClick={() => window.location.reload()}>
        Reload customizer
      </button>
    </main>
  )
}

export default class CustomizerErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[Charmé] customizer render failed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <CustomizerErrorFallback />
  }
}