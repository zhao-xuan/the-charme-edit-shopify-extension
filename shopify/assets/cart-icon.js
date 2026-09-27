import { Component } from '@theme/component';
import { onAnimationEnd } from '@theme/utilities';
import { ThemeEvents, CartUpdateEvent } from '@theme/events';

/**
 * A custom element that displays a cart icon.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} cartBubble - The cart bubble element.
 * @property {HTMLElement} cartBubbleText - The cart bubble text element.
 * @property {HTMLElement} cartBubbleCount - The cart bubble count element.
 *
 * @extends {Component<Refs>}
 */
class CartIcon extends Component {
  requiredRefs = ['cartBubble', 'cartBubbleText', 'cartBubbleCount'];
  cartRequestId = 0;

  /** @type {number} */
  get currentCartCount() {
    return parseInt(this.refs.cartBubbleCount.textContent ?? '0', 10);
  }

  set currentCartCount(value) {
    this.refs.cartBubbleCount.textContent = value < 100 ? String(value) : '';
  }

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener(ThemeEvents.cartUpdate, this.onCartUpdate);
    document.addEventListener('cart:refresh', this.onCartUpdate);
    window.addEventListener('pageshow', this.ensureCartBubbleIsCorrect);
    this.ensureCartBubbleIsCorrect();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    document.removeEventListener(ThemeEvents.cartUpdate, this.onCartUpdate);
    document.removeEventListener('cart:refresh', this.onCartUpdate);
    window.removeEventListener('pageshow', this.ensureCartBubbleIsCorrect);
    this.cartRequestId += 1;
  }

  /**
   * Handles the cart update event.
   * @param {CartUpdateEvent} event - The cart update event.
   */
  onCartUpdate = async (event) => {
    await this.refreshCartCount(true);
  };

  refreshCartCount = async (animate = false) => {
    const requestId = ++this.cartRequestId;
    try {
      const root = window.Shopify?.routes?.root || '/';
      const response = await fetch(`${root}cart.js`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) return;
      const cart = await response.json();
      if (requestId !== this.cartRequestId || !Array.isArray(cart.items)) return;
      const itemCount = cart.items.reduce((count, item) =>
        count + (item.properties?._role === 'charm' ? 0 : Number(item.quantity) || 0), 0);
      this.renderCartBubble(itemCount, false, animate);
    } catch (_) {
    }
  };

  /**
   * Renders the cart bubble.
   * @param {number} itemCount - The number of items in the cart.
   * @param {boolean} comingFromProductForm - Whether the cart update is coming from the product form.
   */
  renderCartBubble = async (itemCount, comingFromProductForm, animate = true) => {
    // If the cart update is coming from the product form, we add to the current cart count, otherwise we set the new cart count

    this.refs.cartBubbleCount.classList.toggle('hidden', itemCount === 0);
    this.refs.cartBubble.classList.toggle('visually-hidden', itemCount === 0);
    this.refs.cartBubble.classList.toggle('cart-bubble--animating', itemCount > 0 && animate);

    this.currentCartCount = comingFromProductForm ? this.currentCartCount + itemCount : itemCount;

    this.classList.toggle('header-actions__cart-icon--has-cart', itemCount > 0);

    try {
      sessionStorage.setItem(
        'charme-cart-count',
        JSON.stringify({
          value: String(this.currentCartCount),
          timestamp: Date.now(),
        })
      );
    } catch (_) {
    }

    if (!animate) return;
    await onAnimationEnd(this.refs.cartBubbleText);

    this.refs.cartBubble.classList.remove('cart-bubble--animating');
  };

  /**
   * Checks if the cart count is correct.
   */
  ensureCartBubbleIsCorrect = () => this.refreshCartCount(false);
}

if (!customElements.get('cart-icon')) {
  customElements.define('cart-icon', CartIcon);
}