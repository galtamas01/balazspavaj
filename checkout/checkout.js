class CheckoutCart extends HTMLElement {
    connectedCallback() {
        this.render();
    }

    render() {
        const cart = JSON.parse(localStorage.getItem('shoppingCart')) || [];

        if (cart.length === 0) {
            this.innerHTML = `
                <div class="empty-cart">
                    <div class="empty-cart-icon-container fade-in">
                        <span class="material-symbols-outlined">shopping_cart_off</span>
                    </div>
                    <h3 class="subtitle fade-in fade-delay-1">Coșul tău este gol</h3>
                    <p class="desc-text fade-in fade-delay-2">Descoperă produsele noastre premium și alege cele mai bune soluții pentru proiectul tău de amenajare.</p>
                    <a href="/index.html#produse" class="menu-button fade-in fade-delay-3">Înapoi la magazin</a>
                    <div class="empty-cart-line fade-in fade-delay-4"></div>
                        <div class="product-categories fade-delay-5">
                        <h3 class="subtitle">Categorii Populare</h3>
                        <product-categories></product-categories>
                    </div>
                </div>
            `;
            return;
        }

        let cartItemsHTML = '';
        let subtotal = 0;

        cart.forEach((item, index) => {
            const elementPrice = parseInt(item.price);
            const itemTotal = elementPrice * item.quantity;
            subtotal += itemTotal;

            const formattedItemTotal = itemTotal.toLocaleString('ro-RO');

            let detailsHTML = '';
            if (item.color) detailsHTML += `<p>Culoare: ${item.color}</p>`;
            if (item.type) detailsHTML += `<p>Tip: ${item.type}</p>`;

            cartItemsHTML += `
                <div class="cart-item">
                    <div class="cart-item-image">
                        <img src="${item.image}" alt="${item.name}">
                    </div>
                    <div class="cart-item-text">
                        <button class="delete" data-index="${index}"><span class="material-symbols-outlined">delete</span></button>
                        <h3>${item.name}</h3>
                        ${detailsHTML}
                        <p>Cantitate: ${item.quantity} paleti</p>
                        <p class="price-tag">${formattedItemTotal} RON</p>
                    </div>
                </div>
            `;
        });

        const formattedSubtotal = subtotal.toLocaleString('ro-RO');

        
        this.innerHTML = `
            <div id="progress-bar">
                <div class="step">
                    <div class="step-circle step-1 active">1</div>
                    <p class="step-name">Coș</p>
                </div>
                <div class="line"></div>
                <div class="step">
                    <div class="step-circle step-2">2</div>
                    <p class="step-name">Livrare</p>
                </div>
                <div class="line"></div>
                <div class="step">
                    <div class="step-circle step-3 ">3</div>
                    <p class="step-name">Finalizare</p>
                </div>
            </div>

            <hgroup>
                <h2 class="subtitle" id="main-title" >Coșul tău</h2>
                <p>(${cart.length} produse)</p>
            </hgroup>
            <div class="line hgroup-line"></div>

            <main>
                <section class="cart-items">
                    ${cartItemsHTML}
                    
                    <a href="/index.html#products" class="back-to-shop-btn">
                        <span class="material-symbols-outlined">
                            keyboard_backspace
                        </span>
                        Continuă cumpărăturile
                    </a>
                </section>
                
                <section class="checkout-summary">
                    <div class="summary-card">
                        <div class="summary-header">
                            <h3 class="subtitle">Sumar comandă</h3>
                        </div>
                        <div class="summary-body">
                            <div class="subtotal">
                                <p>Subtotal</p>
                                <p>${formattedSubtotal} RON</p>
                            </div>
                            <div class="delivery">
                                <p>Livrare</p>
                                <p>Calculat la final</p>
                            </div>
                        </div>
                        <div class="separator-line"></div>
                        <div class="summary-footer">
                            <div class="total">
                                <p>Total</p>
                                <p>${formattedSubtotal} RON</p>
                            </div>
                            <button id="btn-next-step" class="menu-button">Continuă</button>
                        </div>
                    </div>

                    <div class="summary-card help">
                        <div class="summary-header">
                            <h3 class="subtitle">Aveți întrebări?</h3>
                        </div>
                        <div class="summary-body">
                            <p>Contactează-ne pentru asistență!</p>
                        </div>
                        <div class="summary-footer">
                            <span class="material-symbols-outlined">call</span>
                            <p>0722 222 222</p>
                        </div>
                    </div>
                </section>
            </main>
        `;

        this.attachEventListeners();

        const nextStepBtn = document.getElementById('btn-next-step');

        if (nextStepBtn) {
            nextStepBtn.addEventListener('click', () => {
                if (cart.length == 0) return;

                this.innerHTML = `
                     <div id="progress-bar">
                        <div class="step">
                            <div class="step-circle step-1 active">1</div>
                            <p class="step-name">Coș</p>
                        </div>
                        <div class="line"></div>
                        <div class="step">
                            <div class="step-circle step-2 active">2</div>
                            <p class="step-name">Livrare</p>
                        </div>
                        <div class="line"></div>
                        <div class="step">
                            <div class="step-circle step-3 ">3</div>
                            <p class="step-name">Finalizare</p>
                        </div>
                    </div>

                    <hgroup>
                        <h2 class="subtitle" id="main-title" >Detalii Livrare</h2>
                    </hgroup>
                    <div class="line hgroup-line"></div>

                    <main>
                        <section class="cart-items">
                             <div class="form-container">
                                <form action="" id="delivery-form">
                                    <div>
                                        <div class="input-container input-name-container">
                                            <label for="nume">Nume <br>
                                                <input type="text" id="nume" name="nume" placeholder="Nume" required>
                                            </label>
                                            <label for="prenume">Prenume <br>
                                                <input type="text" id="prenume" name="prenume" placeholder="Prenume" required>
                                            </label>
                                        </div>

                                        <div class="input-container input-mail-tel-container">
                                            <label for="email">Email <br>
                                                <input type="email" id="email" name="email" placeholder="Email" required>
                                            </label>
                                            <label for="tel">Telefon <br>
                                                <input type="tel" id="tel" name="tel" placeholder="07********" required>
                                            </label>
                                        </div>
                                    </div>

                                    <div class="input-container input-address-container">
                                        <label for="adresa">Adresă <br>
                                            <input type="text" id="adresa" name="adresa" placeholder="Strada, număr, etc." required>    
                                        </label>
                                    </div>

                                    <div class="input-container input-loc-container">
                                        <label for="judet">Județ <br>
                                            <input type="text" id="judet" name="judet" placeholder="Județ" required>
                                        </label>
                                        <label for="loc">Localitate <br>
                                            <input type="text" id="loc" name="loc" placeholder="Localitate" required>
                                        </label>
                                        <label for="codp">Cod Poștal <br>
                                            <input type="number" id="codp" name="codp" placeholder="Cod Poștal" required>
                                        </label>
                                    </div>
                                    
                                    <div class="input-container note-container">
                                        <label for="mentiuni">Mențiuni (opțional) <br>
                                            <textarea name="mentiuni" id="mentiuni" rows="5" placeholder="Adaugă detalii, preferințe sau instrucțiuni speciale pentru livrare..."></textarea>
                                        </label>
                                    </div>
                                </form>
                            </div>
                            
                            <a href="/checkout/checkout.html" class="back-to-shop-btn">
                                <span class="material-symbols-outlined">
                                    keyboard_backspace
                                </span>
                                Înapoi la coș
                            </a>
                        </section>
                        
                        <section class="checkout-summary">
                            <div class="summary-card">
                                <div class="summary-header">
                                    <h3 class="subtitle">Sumar comandă</h3>
                                </div>
                                <div class="summary-body">
                                    <div class="subtotal">
                                        <p>Subtotal</p>
                                        <p>${formattedSubtotal} RON</p>
                                    </div>
                                    <div class="delivery">
                                        <p>Livrare</p>
                                        <p>Calculat la final</p>
                                    </div>
                                </div>
                                <div class="separator-line"></div>
                                <div class="summary-footer">
                                    <div class="total">
                                        <p>Total</p>
                                        <p>${formattedSubtotal} RON</p>
                                    </div>
                                    <button type="submit"id="final-btn" class="menu-button" form="delivery-form">Finalizare comandă</button>
                                </div>
                            </div>

                            <div class="summary-card help">
                                <div class="summary-header">
                                    <h3 class="subtitle">Aveți întrebări?</h3>
                                </div>
                                <div class="summary-body">
                                    <p>Contactează-ne pentru asistență!</p>
                                </div>
                                <div class="summary-footer">
                                    <span class="material-symbols-outlined">call</span>
                                    <p>0722 222 222</p>
                                </div>
                            </div>
                        </section>
                    </main>
                `;

                const deliveryForm = document.getElementById('delivery-form');
                if (deliveryForm) {
                    deliveryForm.addEventListener('submit', (e) => {
                        e.preventDefault();

                        const formData = new FormData(deliveryForm);
                        const customerData = Object.fromEntries(formData.entries());

                        const currentCart = JSON.parse(localStorage.getItem('shoppingCart'));

                        const orderPayload = {
                            customer: customerData,
                            items: currentCart,
                            total: formattedSubtotal,
                            orderDate: new Date().toLocaleString('ro-RO')
                        }

                        const gasURL = "https://script.google.com/macros/s/AKfycbwZ1hYoPHPN8UAKvH4hXqfnh0ezKn9WmC9NZVYs90lTstpLpQQoWmrOjkTZUpS5JKqlGg/exec";
                        document.getElementById('final-btn').disabled = true;

                        fetch(gasURL, {
                            method: 'POST',
                            mode: 'no-cors',
                            headers: {
                                'Content-Type': 'text/plain;charset=utf-8'
                            },
                            body: JSON.stringify(orderPayload),
                            redirect: 'follow'
                        })
                        .then(() => {
                            console.log("Comanda a fost trimisă!");
                            
                            localStorage.removeItem('shoppingCart');
                            
                            window.location.href = '/checkout/succes.html'; 
                        })
                        .catch(error => {
                            console.error("New error: ", error);
                            alert("A apărut o eroare la trimiterea comenzii. Vă rugăm să încercați din nou.");
                            document.getElementById('final-btn').disabled = "false";
                        });
                    });
                }

                window.scrollTo(0, 0);
            })
        }
        
    }

    attachEventListeners() {
        const deleteButtons = this.querySelectorAll('.delete');
        deleteButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const button = e.target.closest('.delete');
                const indexToRemove = button.getAttribute('data-index');

                let cart = JSON.parse(localStorage.getItem('shoppingCart')) || [];
                cart.splice(indexToRemove, 1);
                localStorage.setItem('shoppingCart', JSON.stringify(cart));

                this.render();
            });
        });
    }

}

customElements.define('checkout-cart', CheckoutCart);
ShowDeliveryDetails();

function ShowDeliveryDetails() {
    
}