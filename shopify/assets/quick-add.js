import { morph } from '@theme/morph';
import { Component } from '@theme/component';
import { ThemeEvents } from '@theme/events';
import { DialogComponent, DialogCloseEvent } from '@theme/dialog';
import { mediaQueryLarge, isMobileBreakpoint, getIOSVersion } from '@theme/utilities';

export class QuickAddComponent extends Component {
  #pendingRequests = new Map();
  #requestControllers = new Map();
  #cachedContent = new Map();
  #clickSequence = 0;
  #activeClickUrl = '';

  get productPageUrl() {
    const productLink = this.closest('product-card')?.getProductCardLink();
    if (!productLink?.href) return '';
    const url = new URL(productLink.href);
    if (url.searchParams.has('variant')) return url.toString();
    const selectedVariantId = this.#getSelectedVariantId();
    if (selectedVariantId) url.searchParams.set('variant', selectedVariantId);
    return url.toString();
  }

  #getSelectedVariantId() {
    return this.closest('product-card')?.getSelectedVariantId() || null;
  }

  connectedCallback() {
    super.connectedCallback();
    mediaQueryLarge.addEventListener('change', this.#closeQuickAddModal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    mediaQueryLarge.removeEventListener('change', this.#closeQuickAddModal);
    this.#clickSequence++;
    this.#activeClickUrl = '';
    this.removeAttribute('aria-busy');
    this.#requestControllers.forEach(controller => controller.abort());
    this.#requestControllers.clear();
    this.#pendingRequests.clear();
  }

  handleClick = async event => {
    event.preventDefault();
    const currentUrl = this.productPageUrl;
    if (!currentUrl || this.#activeClickUrl === currentUrl) return;
    const sequence = ++this.#clickSequence;
    this.#activeClickUrl = currentUrl;
    this.setAttribute('aria-busy', 'true');
    const isCurrent = () => this.isConnected && sequence === this.#clickSequence && this.productPageUrl === currentUrl;
    try {
      let productGrid = this.#cachedContent.get(currentUrl);
      if (!productGrid) {
        const html = await this.fetchProductPage(currentUrl);
        if (!isCurrent()) return;
        const gridElement = html?.querySelector('[data-product-grid-content]');
        if (gridElement) {
          productGrid = gridElement.cloneNode(true);
          this.#cachedContent.set(currentUrl, productGrid);
        }
      }
      if (!isCurrent()) return;
      if (!productGrid) {
        window.location.assign(currentUrl);
        return;
      }
      await this.updateQuickAddModal(productGrid.cloneNode(true));
      if (isCurrent()) this.#openQuickAddModal();
    } catch (error) {
      if (isCurrent()) {
        console.warn('[Charme] quick add unavailable', { name: error.name });
        window.location.assign(currentUrl);
      }
    } finally {
      if (sequence === this.#clickSequence) {
        this.#activeClickUrl = '';
        this.removeAttribute('aria-busy');
      }
    }
  };

  #stayVisibleUntilDialogCloses(dialogComponent) {
    this.toggleAttribute('stay-visible', true);
    dialogComponent.addEventListener(DialogCloseEvent.eventName, () => this.toggleAttribute('stay-visible', false), { once: true });
  }

  #openQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (dialogComponent instanceof QuickAddDialog) {
      this.#stayVisibleUntilDialogCloses(dialogComponent);
      dialogComponent.showDialog();
    }
  };

  #closeQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (dialogComponent instanceof QuickAddDialog) dialogComponent.closeDialog();
  };

  async fetchProductPage(productPageUrl) {
    if (!productPageUrl) return null;
    const pendingRequest = this.#pendingRequests.get(productPageUrl);
    if (pendingRequest) return pendingRequest;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    const request = (async () => {
      let status = null;
      try {
        const response = await fetch(productPageUrl, { signal: controller.signal });
        status = response.status;
        if (!response.ok) throw new Error('HTTP error');
        const responseText = await response.text();
        if (controller.signal.aborted) return null;
        return new DOMParser().parseFromString(responseText, 'text/html');
      } catch (error) {
        if (timedOut || (!controller.signal.aborted && error.name !== 'AbortError')) {
          console.warn('[Charme] quick add fetch failed', { status, reason: timedOut ? 'timeout' : error.name });
        }
        return null;
      } finally {
        clearTimeout(timeout);
        if (this.#requestControllers.get(productPageUrl) === controller) {
          this.#requestControllers.delete(productPageUrl);
          this.#pendingRequests.delete(productPageUrl);
        }
      }
    })();
    this.#requestControllers.set(productPageUrl, controller);
    this.#pendingRequests.set(productPageUrl, request);
    return request;
  }

  async updateQuickAddModal(productGrid) {
    const modalContent = document.getElementById('quick-add-modal-content');
    if (!productGrid || !modalContent) return;
    if (isMobileBreakpoint()) {
      const productDetails = productGrid.querySelector('.product-details');
      const productFormComponent = productGrid.querySelector('product-form-component');
      const variantPicker = productGrid.querySelector('variant-picker');
      const productPrice = productGrid.querySelector('product-price');
      const productTitle = document.createElement('a');
      productTitle.textContent = this.dataset.productTitle || '';
      productTitle.href = this.productPageUrl;
      const productHeader = document.createElement('div');
      productHeader.classList.add('product-header');
      productHeader.appendChild(productTitle);
      if (productPrice) productHeader.appendChild(productPrice);
      productGrid.appendChild(productHeader);
      if (variantPicker) productGrid.appendChild(variantPicker);
      if (productFormComponent) productGrid.appendChild(productFormComponent);
      productDetails?.remove();
    }
    morph(modalContent, productGrid);
    this.#syncVariantSelection(modalContent);
  }

  #syncVariantSelection(modalContent) {
    const selectedVariantId = this.#getSelectedVariantId();
    if (!selectedVariantId) return;
    const modalInputs = modalContent.querySelectorAll('input[type="radio"][data-variant-id]');
    for (const input of modalInputs) {
      if (input instanceof HTMLInputElement && input.dataset.variantId === selectedVariantId && !input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  }
}

if (!customElements.get('quick-add-component')) customElements.define('quick-add-component', QuickAddComponent);

class QuickAddDialog extends DialogComponent {
  #abortController = new AbortController();
  connectedCallback() {
    super.connectedCallback();
    this.addEventListener(ThemeEvents.cartUpdate, this.handleCartUpdate, { signal: this.#abortController.signal });
    this.addEventListener(ThemeEvents.variantUpdate, this.#updateProductTitleLink);
    this.addEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }
  handleCartUpdate = event => { if (!event.detail.data.didError) this.closeDialog(); };
  #updateProductTitleLink = event => {
    const anchorElement = event.detail.data.html?.querySelector('.view-product-title a');
    const viewMoreDetailsLink = this.querySelector('.view-product-title a');
    const mobileProductTitle = this.querySelector('.product-header a');
    if (anchorElement) {
      if (viewMoreDetailsLink) viewMoreDetailsLink.href = anchorElement.href;
      if (mobileProductTitle) mobileProductTitle.href = anchorElement.href;
    }
  };
  #handleDialogClose = () => {
    const iosVersion = getIOSVersion();
    if (!iosVersion || iosVersion.major >= 17 || (iosVersion.major === 16 && iosVersion.minor >= 4)) return;
    requestAnimationFrame(() => {
      const grid = document.querySelector('#ResultsList [product-grid-view]');
      if (grid) {
        const currentWidth = grid.getBoundingClientRect().width;
        grid.style.width = `${currentWidth - 1}px`;
        requestAnimationFrame(() => { grid.style.width = ''; });
      }
    });
  };
}

if (!customElements.get('quick-add-dialog')) customElements.define('quick-add-dialog', QuickAddDialog);