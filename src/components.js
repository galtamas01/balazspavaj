class Navbar extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
            <nav>
                <a href="/"><img src="/assets/balazspavaj_logo.png" alt="Balázs Pavaj Logo" id="nav-logo"></a>
                <div id="menu-button-container">
                    <a href="#products" class="menu-button">Produse</a>
                    <a href="#faq" class="menu-button">FAQ</a>
                    <a href="#about-section" class="menu-button">Despre noi</a>
                </div>
                <div id="social-media-icons">
                    <a href="/checkout/checkout.html"><img src="/assets/cart_icon.svg" alt="Cart icon" id="cart-icon-desktop"></a>
                    <a href=""><img src="/assets/social_media_icons/facebook.svg" alt="Facebook icon" class="social-icon"></a>
                    <a href=""><img src="/assets/social_media_icons/instagram.svg" alt="Instagram icon" class="social-icon"></a>
                    <a href=""><img src="/assets/social_media_icons/tiktok.svg" alt="Tiktok icon" class="social-icon"></a>
                </div>
                <div id="hamburger-icon">
                    <a href="/checkout/checkout.html"><img src="/assets/cart_icon.svg" alt="Cart icon" id="cart-icon-mobile"></a>
                <button id="hamburger-icon-btn">
                    <span>☰</span>
                </button>
                </div>
            </nav>
            <div id="mobile-menu-container">
                <button id="mobile-menu-close">&times;</button>
                <div id="mobile-menu">
                    <a href="/index.html#products" class="mobile-menu-button">Produse</a>
                    <a href="/index.html#faq" class="mobile-menu-button">FAQ</a>
                    <a href="/index.html#about-section" class="mobile-menu-button">Despre noi</a>
                    <div class="social-media-icons">
                        <a href=""><img src="/assets/social_media_icons/facebook.svg" alt="Facebook icon" class="social-icon"></a>
                        <a href=""><img src="/assets/social_media_icons/instagram.svg" alt="Instagram icon" class="social-icon"></a>
                        <a href=""><img src="/assets/social_media_icons/tiktok.svg" alt="Tiktok icon" class="social-icon"></a>
                    </div>
                </div>
            </div>
        `
    }
}

class Footer extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
        <footer>
            <p>© Balázs Pavaj - 2026</p>
            <div class="social-media-icons">
                <a href="#"><img src="/assets/social_media_icons/facebook_wh.svg" alt="Facebook icon"></a>
                <a href="#"><img src="/assets/social_media_icons/instagram_wh.svg" alt="Instagram icon"></a>
                <a href="#"><img src="/assets/social_media_icons/tiktok_wh.svg" alt="Tiktok icon"></a>
            </div>
        </footer>
        `
    }
}

class ProductsGrid extends HTMLElement {
    connectedCallback() {
        const dataSource = this.getAttribute('source') || '/produse/products.json';
        const category = this.getAttribute('category');

        fetch(dataSource)
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok ' + response.statusText);
                }
                return response.json();
            })
            .then(data => {
                const productItems = Object.entries(data[category]);

                productItems.forEach(([productId, product], index) => {
                    const link = `/produse/produs.html?cat=${category}&id=${productId}`;
                    const card = document.createElement('div');
                    card.classList.add('product-card');

                    card.innerHTML = `
                        <div class="product-card-image">
                            <img src="${product.image}" alt="Product image">
                        </div>
                        <div class="product-card-text">
                            <h3>${product.name}</h3>
                            <span class="line"></span>
                            <div class="product-details">
                                <div class="product-details-left">
                                    <span>${product.palettes}</span>
                                    <span>${product.price} RON</span>
                                </div>
                                <div class="product-details-right">
                                    <a href="${link}" class="menu-button">Detalii</a>
                                </div>
                            </div>
                            <span class="product-card-badge">Diverse culori</span>  
                        </div>
                        `;

                    if (product.colors && product.colors.length > 1) {
                        card.querySelector('.product-card-badge').style.display = 'flex';
                    }

                    card.classList.add(`fade-delay-${index + 1}`);
                    this.appendChild(card);
                })
            })
            .catch(error => {
                console.error('Log output: There was a problem with the fetch operation:', error);
            });
    }
}

class ProductCategories extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
            <h2 class="subtitle">Categorii de produse</h2>
                <div id="products-grid">
                    <a href="/produse/pavaje.html">
                        <div class="product fade-in fade-delay-1">
                        <div class="product-card-image">
                            <img src="/assets/category_pavaj.png" alt="Product image">
                        </div>
                        <div class="product-card-text">
                            <h3>Pavaje</h3>
                            <p>Detalii &nbsp; &rarr;</p>
                        </div>
                        </div>
                    </a>
                    <a href="/produse/premium-pavaje.html">
                        <div class="product fade-in fade-delay-2">
                        <div class="product-card-image">
                            <img src="/assets/category_premium.png" alt="Product image">
                        </div>
                        <div class="product-card-text">
                            <h3>Pavaje Premium</h3>
                            <p>Detalii &nbsp; &rarr;</p>
                        </div>
                        </div>
                    </a>
                    <a href="/produse/borduri.html">
                        <div class="product fade-in fade-delay-3">
                        <div class="product-card-image">
                            <img src="/assets/category_bordura.png" alt="Product image">
                        </div>
                        <div class="product-card-text">
                            <h3>Borduri</h3>
                            <p>Detalii &nbsp; &rarr;</p>
                        </div>
                        </div>
                    </a>
                    <a href="/produse/rigole.html">
                        <div class="product fade-in fade-delay-4">
                        <div class="product-card-image">
                            <img src="/assets/category_rigola.png" alt="Product image">
                        </div>
                        <div class="product-card-text">
                            <h3>Rigole</h3>
                            <p>Detalii &nbsp; &rarr;</p>
                        </div>
                        </div>
                    </a>
            </div>
        `
    }
}

customElements.define('navbar-element', Navbar);
customElements.define('footer-element', Footer);
customElements.define('products-grid', ProductsGrid);
customElements.define('product-categories', ProductCategories);