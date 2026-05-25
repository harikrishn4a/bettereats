#!/usr/bin/env node

import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const DISTRICTS = [
  { name: 'Ang Mo Kio', lat: 1.37016, lng: 103.84963 },
  { name: 'Bedok', lat: 1.32485, lng: 103.93379 },
  { name: 'Bishan', lat: 1.35132, lng: 103.84873 },
  { name: 'Bukit Batok', lat: 1.34475, lng: 103.74804 },
  { name: 'Bukit Merah', lat: 1.27969, lng: 103.81565 },
  { name: 'Bukit Timah', lat: 1.34162, lng: 103.75915 },
  { name: 'Choa Chu Kang', lat: 1.38447, lng: 103.74393 },
  { name: 'Clementi', lat: 1.31511, lng: 103.76218 },
  { name: 'Geylang', lat: 1.30726, lng: 103.86398 },
  { name: 'Hougang', lat: 1.36731, lng: 103.89308 },
  { name: 'Jurong East', lat: 1.34081, lng: 103.74475 },
  { name: 'Jurong West', lat: 1.34053, lng: 103.70476 },
  { name: 'Kallang', lat: 1.30627, lng: 103.87353 },
  { name: 'Katong', lat: 1.29815, lng: 103.89849 },
  { name: 'Macpherson', lat: 1.32638, lng: 103.87036 },
  { name: 'Marine Parade', lat: 1.3017, lng: 103.89606 },
  { name: 'Novena', lat: 1.32034, lng: 103.84308 },
  { name: 'Orchard', lat: 1.30449, lng: 103.83441 },
  { name: 'Potong Pasir', lat: 1.32961, lng: 103.86201 },
  { name: 'Punggol', lat: 1.40451, lng: 103.90434 },
  { name: 'Queenstown', lat: 1.29589, lng: 103.80194 },
  { name: 'Serangoon', lat: 1.35069, lng: 103.87195 },
  { name: 'Sengkang', lat: 1.39485, lng: 103.8949 },
  { name: 'Senoko', lat: 1.43989, lng: 103.80566 },
  { name: 'Sentosa', lat: 1.24955, lng: 103.82065 },
  { name: 'Sembawang', lat: 1.42383, lng: 103.82209 },
  { name: 'Tampines', lat: 1.35272, lng: 103.94502 },
  { name: 'Tanjong Pagar', lat: 1.27668, lng: 103.84485 }
];

let supabase;
let cookies = [];

async function initSupabase() {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('✅ Supabase connected\n');
}

async function connectToExistingBrowser() {
  console.log('🔌 Connecting to Chrome with debugging port...\n');

  const response = await fetch('http://127.0.0.1:9222/json/version');
  const data = await response.json();
  const wsEndpoint = data.webSocketDebuggerUrl;

  console.log(`Found endpoint: ${wsEndpoint}`);

  const browser = await puppeteer.connect({
    browserWSEndpoint: wsEndpoint,
  });

  console.log('✅ Connected to existing Chrome instance!\n');
  return browser;
}

async function fetchCookiesFromBrowser() {
  console.log('🔗 Connecting to Chrome browser to extract authentication...\n');

  try {
    const browser = await connectToExistingBrowser();

    const pages = await browser.pages();
    const page = pages.find(p => p.url().includes('grab.com')) || pages[0];

    console.log(`Using browser tab: ${await page.title()}\n`);

    cookies = await page.cookies();
    console.log(`✅ Extracted ${cookies.length} cookies from browser\n`);

    await browser.disconnect();
    return true;
  } catch (error) {
    console.error('❌ Could not connect to Chrome');
    console.error('\nPlease follow these steps:');
    console.error('1. Run: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --incognito --user-data-dir=/tmp/chrome-debug https://food.grab.com/sg/en/restaurants &');
    console.error('2. Log into Grab in that Chrome window');
    console.error('3. Run this script again');
    console.error('\nError details:', error.message);
    return false;
  }
}

async function callGrabAPI(lat, lng, offset = 0) {
  try {
    const payload = {
      latlng: `${lat},${lng}`,
      keyword: '',
      offset: offset,
      pageSize: 32,
      countryCode: 'SG'
    };

    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const response = await fetch('https://portal.grab.com/foodweb/guest/v2/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Country-Code': 'SG',
        'X-Gfc-Country': 'SG',
        'X-Grab-Web-App-Version': '26yyTbu4FdOlUheJ4la26',
        'Origin': 'https://food.grab.com',
        'Referer': 'https://food.grab.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        'Cookie': cookieHeader
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const searchMerchants = data.searchResult?.searchMerchants || [];
    
    const restaurants = searchMerchants.map(m => ({
      name: m.address?.name || '',
      cuisine: (m.merchantBrief?.cuisine || []).join(', '),
      rating: m.merchantBrief?.rating || 0,
      delivery_time: m.estimatedDeliveryTime ? `${m.estimatedDeliveryTime} mins` : '',
      url: `https://food.grab.com/sg/en/restaurant/${m.id}` || '',
      lat: m.latlng?.latitude || 0,
      lng: m.latlng?.longitude || 0
    })).filter(r => r.name.length > 0);

    return restaurants;
  } catch (error) {
    return [];
  }
}

async function scrapeDistrict(district, index, total) {
  console.log(`\n[${index}/${total}] ${district.name}`);
  console.log(`  📍 Lat: ${district.lat}, Lng: ${district.lng}`);
  console.log(`  🔄 Fetching all restaurants...`);
  
  let allRestaurants = [];
  let offset = 0;
  let pageNum = 1;
  
  // Paginate through all restaurants
  while (true) {
    const restaurants = await callGrabAPI(district.lat, district.lng, offset);
    
    if (restaurants.length === 0) {
      break;
    }
    
    console.log(`    📄 Page ${pageNum} (offset ${offset}): ${restaurants.length} restaurants`);
    allRestaurants = allRestaurants.concat(restaurants);
    
    offset += 32;
    pageNum++;
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`  🍽️  Found ${allRestaurants.length} restaurants total`);
  
  if (allRestaurants.length > 0) {
    const first3 = allRestaurants.slice(0, 3).map(r => r.name).join(', ');
    console.log(`  📋 First 3: ${first3}`);
  }
  
  // Save to Supabase
  if (allRestaurants.length > 0) {
    const uniqueRestaurants = [];
    const seen = new Set();
    
    allRestaurants.forEach(r => {
      const key = `${r.name}|${district.name}`;
      if (!seen.has(key)) {
        uniqueRestaurants.push({
          name: r.name,
          cuisine: r.cuisine,
          rating: r.rating,
          grab_url: r.url,
          district: district.name,
          delivery_time: r.delivery_time,
          health_score: 0,
          latitude: r.lat,
          longitude: r.lng,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        seen.add(key);
      }
    });
    
    if (uniqueRestaurants.length > 0) {
      const { error } = await supabase
        .from('restaurants')
        .insert(uniqueRestaurants);
      
      if (error) {
        console.log(`  ❌ Insert error: ${error.message}`);
      } else {
        console.log(`  ✅ Saved ${uniqueRestaurants.length} restaurants`);
      }
    }
  }
}

async function main() {
  console.log('🚀 Extracting Restaurants via Grab API (with Pagination)\n');
  
  await initSupabase();
  
  const cookiesOk = await fetchCookiesFromBrowser();
  if (!cookiesOk) {
    process.exit(1);
  }
  
  for (let i = 0; i < DISTRICTS.length; i++) {
    await scrapeDistrict(DISTRICTS[i], i + 1, DISTRICTS.length);
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Complete!`);
  console.log(`${'='.repeat(60)}\n`);
}

main().catch(console.error);