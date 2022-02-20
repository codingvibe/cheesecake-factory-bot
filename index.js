require('dotenv').config();
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');
const AWS = require('aws-sdk');
s3 = new AWS.S3();
const { TwitterApi } = require('twitter-api-v2');
const getProducts = require('./evals/products');

const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;

const BUCKET = "dev.codingvibe";
const MENU_FILENAME = "cheesecake-factory/current-menu.json";
const MAX_MENU_DELTA = 10;

exports.handler = async (event, context, callback) => {
  let browser;
  const products = []

  try {
    browser = await chromium.puppeteer.launch({
      args: chromium.args,
      defaultViewport: {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
      },
      executablePath: await chromium.executablePath,
      headless: true,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.goto('https://www.thecheesecakefactory.com/menu');
    await page.click('a.c-menu__location__header--subheader');
    await page.waitForSelector('.c-all-categories-sub-categories__link')

    const allLinks = await page.evaluate(() => {
      const links = [];
      const allItems = document.querySelectorAll(".c-all-categories-sub-categories__link");
      for ( let i = 0; i < allItems.length; i++) {
        links.push(allItems[i].href);
      }
      return links;
    });

    const productNames = new Set();
    for ( let i = 0; i < allLinks.length; i++) {
      const pageProducts = await getMenuItems(page, allLinks[i]);
      pageProducts.forEach(product => {
        if (!productNames.has(product.name)) {
          products.push(product);
          productNames.add(product.name);
        }
      });
    }

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
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }

  return callback(null, products);
};

async function outputMenuDiff(productDelta, twitterClient) {
  const addedCheesecakes = productDelta.added.filter(isCheesecake);
  const addedOthers = productDelta.added.filter(isNotCheesecake);
  const removedCheesecakes = productDelta.removed.filter(isCheesecake);
  const removedOthers = productDelta.removed.filter(isNotCheesecake);

  for (let i = 0; i < addedOthers.length; i++) {
    const tweet = `😋 ooOOOoo new menu item! ${addedOthers[i].name}: ${addedOthers[i].description}`
    if (tweet.length > 280) {
      await twitterClient.v2.tweet(`ooOOOoo new menu item! ${addedOthers[i].name}`);
    } else {
      await twitterClient.v2.tweet(tweet);
    }
  }

  for (let i = 0; i < removedOthers.length; i++) {
    const tweet = `😭 F's in chat for everyone's favorite ${removedOthers[i].name} leaving the menu`
    await twitterClient.v2.tweet(tweet);
  }

  for (let i = 0; i < addedCheesecakes.length; i++) {
    const tweet = `🚨 NEW CHEESECAKE! NOT A DRILL! ${addedCheesecakes[i].name}: ${addedCheesecakes[i].description}`
    if (tweet.length > 280) {
      await twitterClient.v2.tweet(`🚨 NEW CHEESECAKE! NOT A DRILL! ${addedCheesecakes[i].name}`);
    } else {
      await twitterClient.v2.tweet(tweet);
    }
  }

  for (let i = 0; i < removedCheesecakes.length; i++) {
    const tweet = `🏹🔥⛵ FOR OUR FALLEN BRETHREN CHEESECAKE ${removedCheesecakes[i].name}: ${removedCheesecakes[i].description}`
    if (tweet.length > 280) {
      await twitterClient.v2.tweet(`🏹🔥⛵ FOR OUR FALLEN BRETHREN CHEESECAKE ${removedCheesecakes[i].name}`);
    } else {
      await twitterClient.v2.tweet(tweet);
    }
  }
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

async function getMenuItems(page, link) {
  console.log(`navigating to ${link}`)
  await page.goto(link);
  await page.waitForSelector(".c-product-card__info");
  return await page.evaluate(getProducts);
}

function printProducts(products) {
  products.forEach(product => {
    console.log(`${product.name}: ${product.description}`);
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

  const removedProductNames =  oldProductNames.filter(name => !newProductNames.includes(name));
  const addedProductNames =  newProductNames.filter(name => !oldProductNames.includes(name));

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