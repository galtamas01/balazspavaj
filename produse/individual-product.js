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
                            <h2>Produsul nu a fost găsit.</h2>
                            <a href="/index.html" class="menu-button">Înapoi la acasă</a>
                        </main>`;
                    return;
                }

                const formattedCategory = category.replace('-', ' ').replace(/\b\w/g, c => c.toUpperCase());

                let colorHtml = '';
                let defaultImage = product.image;
                let defaultPrice = product.price;
                let defaultDimensions = product.dimensions;

                if (product.sizes && product.sizes.length > 0) {
                    const firstSize = product.sizes[0];
                    defaultDimensions = firstSize.dimensions;
                    if (firstSize.image) defaultImage = firstSize.image;
                }

                if (product.colors && product.colors.length > 0) {
                    const firstColor = product.colors[0];
                    const firstColorName = typeof firstColor === 'object' ? firstColor.name : firstColor;
                    
                    if (typeof firstColor === 'object') {
                        if (firstColor.image) defaultImage = firstColor.image;
                        if (firstColor.price) defaultPrice = firstColor.price;
                    }

                    const colorButtons = product.colors.map((color, index) => {
                        const colorName = typeof color === 'object' ? color.name : color;
                        const colorImage = typeof color === 'object' ? (color.image || '') : '';
                        const colorPrice = typeof color === 'object' ? (color.price || '') : '';

                        const cssClass = this.getColorClass(colorName);
                        const activeClass = index === 0 ? 'active' : '';
                        return `
                            <button class="color-swatch ${cssClass} ${activeClass}" 
                                    data-color="${colorName}" 
                                    data-image="${colorImage}" 
                                    data-price="${colorPrice}" 
                                    title="${colorName}"></button>
                        `;
                    }).join('');

                    colorHtml = `
                        <div class="color-selector">
                            <header class="color-header">
                                <p>Culoare</p>
                                <p id="color-name">${firstColorName}</p>
                            </header>
                            <div class="color-options">
                                ${colorButtons}
                            </div>
                        </div>
                    `;
                }

                let sizeHtml = '';
                if (product.sizes && product.sizes.length > 0) {
                    const sizeOptions = product.sizes.map((s, index) => {
                        return `
                            <option value="${s.name}" data-dimensions="${s.dimensions}" data-image="${s.image || ''}">${s.name} (${s.dimensions})</option>
                        `;
                    }).join('');

                    sizeHtml = `
                        <div class="type-selector" style="margin-bottom: 2rem;">
                            <header class="color-header">
                                <p>Dimensiune</p>
                            </header>
                            <select name="size" id="size">
                                ${sizeOptions}
                            </select>
                        </div>
                    `;
                }

                if (product.type && product.type.length > 0) {
                    const firstType = product.type[0];
                    if (typeof firstType === 'object' && firstType.price) {
                        defaultPrice = firstType.price;
                    }
                }

                let typeHtml = '';
                if (product.type && product.type.length > 0) {
                    const typeOptions = product.type.map(t => {
                        const typeName = typeof t === 'object' ? t.name : t;
                        const typePrice = typeof t === 'object' ? (t.price || '') : '';
                        return `
                            <option value="${typeName}" data-price="${typePrice}">${typeName}</option>
                        `;
                    }).join('');

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

                    <main${defaultImage ? '' : ' class="no-image"'}>
                        ${defaultImage ? `
                        <section class="product-image-section">
                            <img src="${defaultImage}" alt="Product image">
                        </section>` : ''}
                        <section class="product-info-section">
                            <header class="info-header">
                                <h1 class="subtitle">${product.name}</h1>
                                <p class="price">${defaultPrice} RON / ${product.unit}</p>
                                <div class="line"></div>
                            </header>

                            ${colorHtml}
                            ${sizeHtml}
                            ${typeHtml}

                            <div class="details-container">
                                <div class="detail">
                                    <p class="detail-header">Dimensiuni</p>
                                    <p class="detail-value" id="dimensions-display">${defaultDimensions || ''}</p>
                                </div>
                                <div class="detail">
                                    <p class="detail-header">Unitate</p>
                                    <p class="detail-value">${product.unit}</p>
                                </div>
                            </div>

                            <div class="quantity-container">
                                <label for="quantity">Cantitate (${product.unit})</label>
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

                        const colorName = swatch.getAttribute('data-color');
                        const colorImage = swatch.getAttribute('data-image');
                        const colorPrice = swatch.getAttribute('data-price');

                        document.getElementById('color-name').textContent = colorName;

                        const imgElement = this.querySelector('.product-image-section img');
                        if (imgElement) {
                            let fallbackImage = product.image;
                            const sizeSelect = this.querySelector('#size');
                            if (sizeSelect && product.sizes) {
                                const selectedSizeObj = product.sizes.find(s => s.name === sizeSelect.value);
                                if (selectedSizeObj && selectedSizeObj.image) {
                                    fallbackImage = selectedSizeObj.image;
                                }
                            }
                            imgElement.src = colorImage || fallbackImage;
                        }

                        const priceElement = this.querySelector('.price');
                        if (priceElement) {
                            priceElement.textContent = `${colorPrice || product.price} RON / ${product.unit}`;
                        }
                    });
                })

                const sizeSelectElement = this.querySelector('#size');
                if (sizeSelectElement) {
                    sizeSelectElement.addEventListener('change', () => {
                        const selectedOption = sizeSelectElement.options[sizeSelectElement.selectedIndex];
                        const sizeDimensions = selectedOption.getAttribute('data-dimensions');
                        const sizeImage = selectedOption.getAttribute('data-image');

                        // Update dimensions text
                        const dimsDisplay = this.querySelector('#dimensions-display');
                        if (dimsDisplay) {
                            dimsDisplay.textContent = sizeDimensions;
                        }

                        // Update image if no color swatch is active
                        const activeSwatch = this.querySelector('.color-swatch.active');
                        if (!activeSwatch && sizeImage) {
                            const imgElement = this.querySelector('.product-image-section img');
                            if (imgElement) {
                                imgElement.src = sizeImage;
                            }
                        }
                    });
                }

                const typeSelectElement = this.querySelector('#type');
                if (typeSelectElement) {
                    typeSelectElement.addEventListener('change', () => {
                        const selectedOption = typeSelectElement.options[typeSelectElement.selectedIndex];
                        const typePrice = selectedOption.getAttribute('data-price');

                        let priceToDisplay = typePrice;
                        if (!priceToDisplay) {
                            const activeSwatch = this.querySelector('.color-swatch.active');
                            priceToDisplay = activeSwatch ? activeSwatch.getAttribute('data-price') : null;
                        }

                        const priceElement = this.querySelector('.price');
                        if (priceElement) {
                            priceElement.textContent = `${priceToDisplay || product.price} RON / ${product.unit}`;
                        }
                    });
                }

                const addToCartBtn = this.querySelector('.quantity-container .menu-button');
                const quantityInput = this.querySelector('#quantity');
                const typeSelect = this.querySelector('#type');
                const sizeSelect = this.querySelector('#size');

                if (addToCartBtn) {
                    addToCartBtn.addEventListener('click', () => {
                        const selectedQuantity = parseInt(quantityInput.value) || 1;
                        const selectedType = typeSelect ? typeSelect.value : null;
                        const selectedSizeName = sizeSelect ? sizeSelect.value : null;

                        const activeSwatch = this.querySelector('.color-swatch.active');
                        const selectedColor = activeSwatch ? activeSwatch.getAttribute('data-color') : null;
                        
                        let fallbackImage = product.image;
                        let selectedSizeObj = null;
                        if (sizeSelect && product.sizes) {
                            selectedSizeObj = product.sizes.find(s => s.name === selectedSizeName);
                            if (selectedSizeObj && selectedSizeObj.image) {
                                fallbackImage = selectedSizeObj.image;
                            }
                        }
                        const selectedImage = activeSwatch ? (activeSwatch.getAttribute('data-image') || fallbackImage) : fallbackImage;
                        
                        let selectedPrice = null;
                        if (typeSelect) {
                            const selectedOption = typeSelect.options[typeSelect.selectedIndex];
                            selectedPrice = selectedOption.getAttribute('data-price');
                        }
                        if (!selectedPrice && activeSwatch) {
                            selectedPrice = activeSwatch.getAttribute('data-price');
                        }
                        if (!selectedPrice) {
                            selectedPrice = product.price;
                        }

                        const cartItem = {
                            id: productId,
                            name: product.name,
                            price: selectedPrice,
                            image: selectedImage,
                            quantity: selectedQuantity,
                            color: selectedColor,
                            type: selectedType,
                            size: selectedSizeName,
                            dimensions: selectedSizeObj ? selectedSizeObj.dimensions : null,
                            unit: product.unit
                        };

                        let cart = JSON.parse(localStorage.getItem('shoppingCart')) || [];

                        const existingItemIndex = cart.findIndex(item =>
                            item.id === cartItem.id &&
                            item.color === cartItem.color &&
                            item.type === cartItem.type &&
                            item.size === cartItem.size
                        );

                        if (existingItemIndex > -1) {
                            cart[existingItemIndex].quantity += cartItem.quantity;
                        } else {
                            cart.push(cartItem);
                        }

                        localStorage.setItem('shoppingCart', JSON.stringify(cart));

                        const modalOverlay = document.createElement('div');
                        modalOverlay.className = 'cart-modal-overlay';
                        
                        const colorSpec = selectedColor ? ` (${selectedColor})` : '';
                        
                        modalOverlay.innerHTML = `
                            <div class="cart-modal">
                                <div class="cart-modal-icon">
                                    <span class="material-symbols-outlined">check_circle</span>
                                </div>
                                <h3>Produs adăugat!</h3>
                                <p>Produsul <strong>${cartItem.name}</strong>${colorSpec} a fost adăugat cu succes la solicitarea de ofertă.</p>
                                <div class="cart-modal-buttons">
                                    <button class="menu-button secondary" id="btn-continue">Continuă cumpărăturile</button>
                                    <a href="/checkout/checkout.html" class="menu-button" id="btn-view-cart">Vezi oferta</a>
                                </div>
                            </div>
                        `;

                        document.body.appendChild(modalOverlay);

                        setTimeout(() => {
                            modalOverlay.classList.add('active');
                        }, 10);

                        const dismissModal = () => {
                            if (modalOverlay.parentNode) {
                                modalOverlay.classList.remove('active');
                                setTimeout(() => {
                                    if (modalOverlay.parentNode) {
                                        modalOverlay.remove();
                                    }
                                }, 300);
                            }
                        };

                        const dismissTimeout = setTimeout(dismissModal, 5000);

                        modalOverlay.querySelector('#btn-continue').addEventListener('click', () => {
                            clearTimeout(dismissTimeout);
                            dismissModal();
                        });

                        modalOverlay.addEventListener('click', (e) => {
                            if (e.target === modalOverlay) {
                                clearTimeout(dismissTimeout);
                                dismissModal();
                            }
                        });

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
            'bazalt': 'basalt',
            'negru': 'black'
        }

        return map[colorName.toLowerCase()] || colorName.toLowerCase().replace(/\s/g, '-');
    }
}

customElements.define('product-details', ProductDetails);