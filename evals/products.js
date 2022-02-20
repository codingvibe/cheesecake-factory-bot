function getProducts() {
  const products = document.querySelectorAll(".c-product-card__info");
  const uniqueProducts = [];
  const productCategory = document.querySelector(".c-menu__side-menu__header__navigation").innerText;
  for (let i = 0; i < products.length; i++) {
    let productName = products[i].querySelector(".c-product-card__name").innerText.trim();
    let productDescription = products[i].querySelector(".c-product-card__details").innerText;
    uniqueProducts.push({
      "name": productName,
      "description": productDescription,
      "category": productCategory
    })
  }
  return uniqueProducts;
}

module.exports = getProducts;