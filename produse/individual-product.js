class ProductDetails extends HTMLElement {
    connectedCallback() {
        const params = new URLSearchParams(window.location.search);
        const category = params.get('cat');
        const productId = params.get('id');

        if (!category || !productId) {
            window.location.href = '/index.html';
        }

        fetch('/produse/products.json')
            .then(res => res.json())
            .then(data => {
                const product = data[category]?.[productId];

                if (!product) {
                    this.innerHTML = `
                        <main style="text-align: center; margin-top: 5rem;">
                            <h2>Produsul nu a fost găsit. (A termék nem található)</h2>
                            <a href="/index.html" class="menu-button">Înapoi la acasă</a>
                        </main>`;
                    return;
                }

                const formattedCategory = category.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase());

                let colorHtml = '';
                if (product.colors && product.colors.length > 0) {
                    const colorButtons = product.colors.map((color, index) => {
                        const cssClass = this.getColorClass(color);
                        const activeClass = index === 0 ? 'active' : '';
                        return `
                            <button class="color-swatch ${cssClass} ${activeClass}" data-color="${color}" title="${color}"></button>
                        `;
                    }).join('');

                    colorHtml = `
                        <div class="color-selector">
                            <header class="color-header">
                                <p>Culoare</p>
                                <p id="color-name">${product.colors[0]}</p>
                            </header>
                            <div class="color-options">
                                ${colorButtons}
                            </div>
                        </div>
                    `;
                }

                let typeHtml = '';
                if (product.type && product.type.length > 0) {
                    const typeOptions = product.type.map(type =>
                        `
                            <option value="${type}">${type}</option>
                        `
                    ).join('');

                    typeHtml = `
                        <div class="type-selector">
                            <header class="color-header">
                                <p>Tip</p>
                            </header>
                            <select name="type" id="type">
                                ${typeOptions}
                            </select>
                        </div>
                    `;
                }

                this.innerHTML = `
                    <header class="main-header">
                        <div class="navigation">
                            <a href="/index.html#products" class="navigation-link">Categorii de produse</a>
                            <span>/</span>
                            <a href="/produse/${category}.html" class="navigation-link">${formattedCategory}</a>
                            <span>/</span>
                            <span class="current-location-link">${product.name}</span>
                        </div>
                    </header>

                    <main>
                        <section class="product-image-section">
                            <img src="${product.image}" alt="Product image">
                        </section>
                        <section class="product-info-section">
                            <header class="info-header">
                                <h1 class="subtitle">${product.name}</h1>
                                <p class="price">${product.price} RON / paleta</p>
                                <div class="line"></div>
                            </header>

                            ${colorHtml}
                            ${typeHtml}

                            <div class="details-container">
                                <div class="detail">
                                    <p class="detail-header">Dimensiuni</p>
                                    <p class="detail-value">${product.dimensions}</p>
                                </div>
                                <div class="detail">
                                    <p class="detail-header">Paleti</p>
                                    <p class="detail-value">${product.palettes}</p>
                                </div>
                            </div>

                            <div class="quantity-container">
                                <label for="quantity">Cantitate (paleti)</label>
                                <div class="quantity-input-container">
                                    <input type="number" name="quantity" id="quantity" value="1" min="1" max="99" required>
                                    <button class="menu-button">Adaugă în coș</button>
                                </div>
                            </div>
                        </section>
                    </main>
                            
                `;

                const swatches = document.querySelectorAll('.color-swatch');

                swatches.forEach(swatch => {
                    swatch.addEventListener('click', () => {
                        swatches.forEach(s => s.classList.remove('active'));
                        swatch.classList.add('active');

                        document.getElementById('color-name').textContent = swatch.getAttribute('data-color');
                    });
                })

                const addToCartBtn = this.querySelector('.quantity-container .menu-button');
                const quantityInput = this.querySelector('#quantity');
                const typeSelect = this.querySelector('#type');
                const colorNameDisplay = this.querySelector('#color-name');

                if (addToCartBtn) {
                    addToCartBtn.addEventListener('click', () => {
                        const selectedQuantity = parseInt(quantityInput.value) || 1;
                        const selectedType = typeSelect ? typeSelect.value : null;
                        const selectedColor = colorNameDisplay ? colorNameDisplay.textContent : null;

                        const cartItem = {
                            id: productId,
                            name: product.name,
                            price: product.price,
                            image: product.image,
                            quantity: selectedQuantity,
                            color: selectedColor,
                            type: selectedType
                        };

                        let cart = JSON.parse(localStorage.getItem('shoppingCart')) || [];

                        const existingItemIndex = cart.findIndex(item =>
                            item.id === cartItem.id &&
                            item.color === cartItem.color &&
                            item.type === cartItem.type
                        );

                        if (existingItemIndex > -1) {
                            cart[existingItemIndex].quantity += cartItem.quantity;
                        } else {
                            cart.push(cartItem);
                        }

                        localStorage.setItem('shoppingCart', JSON.stringify(cart));

                        const originalText = addToCartBtn.textContent;
                        addToCartBtn.textContent = 'Adăugat!';
                        addToCartBtn.disabled = true;

                        setTimeout(() => {
                            addToCartBtn.textContent = originalText;
                            addToCartBtn.disabled = false;
                        }, 2000);
                    });
                }
            })

            .catch(err => {
                console.error(err);
                this.innerHTML = `
                        <main style="text-align: center; margin-top: 5rem;">
                            <h2>Produsul nu a fost găsit.</h2>
                            <a href="/index.html" class="menu-button">Înapoi la acasă</a>
                        </main>`;
            });
    }

    getColorClass(colorName) {
        const map = {
            'gri': 'grey',
            'alb': 'white',
            'antracit': 'anthracite',
            'maro': 'brown',
            'roșu': 'red',
            'bazalt': 'basalt'
        }

        return map[colorName.toLowerCase()] || colorName.toLowerCase().replace(/\s/g, '-');
    }
}

customElements.define('product-details', ProductDetails);