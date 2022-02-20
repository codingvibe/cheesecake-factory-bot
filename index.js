import dotenv from 'dotenv';
dotenv.config();
import AWS from 'aws-sdk';
const s3 = new AWS.S3();
import { TwitterApi } from 'twitter-api-v2';
import fetch from 'node-fetch';

const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;

const BUCKET = "dev.codingvibe";
const MENU_FILENAME = "cheesecake-factory/current-menu.json";
const MAX_MENU_DELTA = 10;
const IMAGE_CDN = "https://olo-images-live.imgix.net/"
const MENU_URL = 'https://nomnom-prod-api.thecheesecakefactory.com/restaurants/171338/menu?nomnom=add-restaurant-to-menu,nested-menu&includedisabled=true'

const handler = async (event, context, callback) => {
  let products = []

  try {
    products = await getProducts();

    const twitterClient = new TwitterApi({
      appKey: TWITTER_API_KEY,
      appSecret: TWITTER_API_SECRET,
      accessToken: TWITTER_ACCESS_TOKEN,
      accessSecret: TWITTER_ACCESS_SECRET,
    });
    
    const lastReadProducts = await readObjectFromS3(BUCKET, MENU_FILENAME);
    const productDelta = diffProducts(lastReadProducts, products);

    if (isOutsideGuardrails(productDelta)) {
      throw new Error("Product delta too large! Fix manually and try again");
    }

    await outputMenuDiff(productDelta, twitterClient);
    await writeToS3(BUCKET, MENU_FILENAME, products);
  } catch (error) {
    return callback(error);
  }

  return callback(null, products);
};

export { handler };

async function getProducts() {
  const products = [];
  const productNames = new Set();
  const res = await fetch(MENU_URL);
  if(res.status > 299) {
    throw new Error ("Could not get menu, oopsie");
  }
  const fullMenu = await res.json();
  for (let i = 0; i < fullMenu.categories.length; i++) {
    const category = fullMenu.categories[i];
    for (let j = 0; j < category.subCategories.length; j++) {
      const subCategory = category.subCategories[j];
      for (let k = 0; k < subCategory.products.length; k++) {
        let image;
        if (subCategory.products[k].images && subCategory.products[k].images.length > 0) {
          image = subCategory.products[k].images[0].filename;
        }
        if (!productNames.has(subCategory.products[k].name)) {
          products.push({
            "name": subCategory.products[k].name.trim(),
            "description": subCategory.products[k].description.trim(),
            "subcategory": subCategory.name.trim(),
            "category": category.name.trim(),
            "image": `${IMAGE_CDN}${image}`
          })
          productNames.add(subCategory.products[k].name);
        }
      }
    }
  }
  return products;
}

async function outputMenuDiff(productDelta, twitterClient) {
  const addedCheesecakes = productDelta.added.filter(isCheesecake);
  const addedOthers = productDelta.added.filter(isNotCheesecake);
  const removedCheesecakes = productDelta.removed.filter(isCheesecake);
  const removedOthers = productDelta.removed.filter(isNotCheesecake);

  for (let i = 0; i < addedOthers.length; i++) {
    const tweet = `😋 ooOOOoo new menu item! ${addedOthers[i].name}: ${addedOthers[i].description}`;
    if (tweet.length > 280) {
      await createTweet(twitterClient, `ooOOOoo new menu item! ${addedOthers[i].name}`, addedOthers[i].image);
    } else {
      await createTweet(twitterClient, tweet, addedOthers[i].image);
    }
  }

  for (let i = 0; i < removedOthers.length; i++) {
    const tweet = `😭 F's in chat for everyone's favorite ${removedOthers[i].name} leaving the menu`
    await createTweet(twitterClient, tweet, removedOthers[i].image);
  }

  for (let i = 0; i < addedCheesecakes.length; i++) {
    const tweet = `🚨 NEW CHEESECAKE! NOT A DRILL! ${addedCheesecakes[i].name}: ${addedCheesecakes[i].description}`
    if (tweet.length > 280) {
      await createTweet(twitterClient, `🚨 NEW CHEESECAKE! NOT A DRILL! ${addedCheesecakes[i].name}`, addedCheesecakes[i].image);
    } else {
      await createTweet(twitterClient, tweet, addedCheesecakes[i].image);
    }
  }

  for (let i = 0; i < removedCheesecakes.length; i++) {
    const tweet = `🏹🔥⛵ FOR OUR FALLEN BRETHREN CHEESECAKE ${removedCheesecakes[i].name}: ${removedCheesecakes[i].description}`
    if (tweet.length > 280) {
      await createTweet(twitterClient, `🏹🔥⛵ FOR OUR FALLEN BRETHREN CHEESECAKE ${removedCheesecakes[i].name}`, removedCheesecakes[i].image);
    } else {
      await createTweet(twitterClient, tweet, removedCheesecakes[i].image);
    }
  }
}

async function createTweet(twitterClient, message, image) {
  if (image) {
    console.log("Need elevated access for this. Uncomment when that happens...");
    /*
    const data = await fetch(image);
    const blob = await (await data.blob()).arrayBuffer();
    const mediaId = await twitterClient.v1.uploadMedia(Buffer.from(blob), {mimeType: "image/jpeg"});
    return await twitterClient.v2.tweet(message, {media_ids: [ mediaId ] });
    */
  }
  return await twitterClient.v2.tweet(message);
}

function isOutsideGuardrails(productDelta) {
  if (productDelta.removed.length > MAX_MENU_DELTA) {
    console.error(`Too many removed products! Found ${productDelta.removed.length}, but max is ${MAX_MENU_DELTA}`)
    return true;
  }
  if (productDelta.added.length > MAX_MENU_DELTA) {
    console.error(`Too many added products! Found ${productDelta.added.length}, but max is ${MAX_MENU_DELTA}`)
    return true;s
  }
  return false;
}

function printProducts(products) {
  products.forEach(product => {
    console.log(`(${product.category} > ${product.subcategory}) ${product.name}: ${product.description}`);
  });
}

function getCheesecakes(products) {
  let cheesecakes = products.filter(isCheesecake);
  cheesecakes.push({
      "name": "Fresh Strawberry",
      "description": "The Original Topped with Glazed Fresh Strawberries. Our Most Popular Flavor for over 40 Years!",
      "category": "Cheesecakes & Specialty Desserts"
  })
  return cheesecakes;
}

function isCheesecake(product) {
  return product && (product.name.toLowerCase().includes("cheesecake") ||
              product.description.toLowerCase().includes("cheesecake")) &&
              product.category.toLowerCase().includes("cheesecake");
}

function isNotCheesecake(product) {
  return !isCheesecake(product);
}

function diffProducts(oldProducts, newProducts) {
  const oldProductNames = oldProducts.map(product => product.name);
  const newProductNames = newProducts.map(product => product.name);

  const removedProductNames = oldProductNames.filter(name => !newProductNames.includes(name));
  const addedProductNames = newProductNames.filter(name => !oldProductNames.includes(name));

  const removedProducts = removedProductNames.map(name => oldProducts.filter(product => product.name == name)[0]);
  const addedProducts = addedProductNames.map(name => newProducts.filter(product => product.name == name)[0]);
  return {
    "added": addedProducts,
    "removed": removedProducts
  };
}

async function writeToS3(bucket, filename, indata) {
  const outdata = Buffer.from(JSON.stringify(indata), 'utf8');
  return new Promise((res) => {
    var params = {
      Body: outdata, 
      Bucket: bucket, 
      Key: filename, 
      ServerSideEncryption: "AES256", 
      StorageClass: "STANDARD_IA"
    };
    s3.putObject(params, function(err, data) {
      if (err) {
        throw new Error(err, err.stack);
      }
      res(data);
    });
  })
}

async function readObjectFromS3(bucket, filename) {
  return new Promise((res) => {
    var params = {
      Bucket: bucket, 
      Key: filename
    };
    s3.getObject(params, function(err, data) {
      if (err) {
        throw new Error(err, err.stack);
      }
      else{
        res(JSON.parse(data.Body.toString('utf8')));
      }
    });
  })
}