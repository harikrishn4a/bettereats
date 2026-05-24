#!/usr/bin/env node

import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

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

async function callGrabMenuAPI(merchantId) {
  try {
    const payload = {
      merchantID: merchantId
    };

    // Build Cookie header from cookies
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const response = await fetch('https://portal.grab.com/foodweb/guest/v2/menu', {
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
      // Rate limited or error
      return null;
    }

    const data = await response.json();
    
    // Parse menu items from response
    const menuGroups = data.menu?.sections || [];
    const items = [];
    
    menuGroups.forEach(section => {
      const dishes = section.items || [];
      dishes.forEach(dish => {
        items.push({
          name: dish.name || '',
          description: dish.description || '',
          price: dish.price || 0,
          dietary_tags: []
        });
      });
    });

    return items.filter(i => i.name.length > 0);
  } catch (error) {
    return null;
  }
}

async function extractMenuItems() {
  console.log('🍽️  Fetching restaurants from Supabase...\n');
  
  // Get all restaurants
  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, name, grab_url')
    .limit(1000);
  
  if (error) {
    console.error('❌ Failed to fetch restaurants:', error.message);
    return;
  }
  
  console.log(`📍 Found ${restaurants.length} restaurants to scrape menus for\n`);
  
  let successCount = 0;
  let rateLimitCount = 0;
  let failureCount = 0;
  
  for (let i = 0; i < restaurants.length; i++) {
    const restaurant = restaurants[i];
    const merchantId = restaurant.grab_url?.split('/restaurant/')[1]?.split('/')[0];
    
    if (!merchantId) {
      failureCount++;
      continue;
    }
    
    // Extract merchant ID from Grab URL
    console.log(`\n[${i + 1}/${restaurants.length}] ${restaurant.name}`);
    console.log(`  🆔 Merchant ID: ${merchantId}`);
    
    // Call menu API
    console.log(`  🔄 Fetching menu...`);
    const menuItems = await callGrabMenuAPI(merchantId);
    
    if (menuItems === null) {
      console.log(`  ⚠️  Rate limited or API error, skipping`);
      rateLimitCount++;
      // Back off on rate limit
      await new Promise(resolve => setTimeout(resolve, 3000));
      continue;
    }
    
    if (menuItems.length === 0) {
      console.log(`  ⚠️  No menu items found`);
      failureCount++;
      continue;
    }
    
    console.log(`  🍴 Found ${menuItems.length} menu items`);
    
    // Insert into menu_items table
    const itemsToInsert = menuItems.map(item => ({
      restaurant_id: restaurant.id,
      name: item.name.substring(0, 255),
      description: item.description.substring(0, 1000),
      price: item.price,
      dietary_tags: item.dietary_tags || [],
      health_score: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    
    const { error: insertError } = await supabase
      .from('menu_items')
      .insert(itemsToInsert);
    
    if (insertError) {
      if (!insertError.message.includes('duplicate')) {
        console.log(`  ❌ Save error: ${insertError.message}`);
        failureCount++;
      } else {
        console.log(`  ✅ Saved ${menuItems.length} menu items (some duplicates)`);
        successCount++;
      }
    } else {
      console.log(`  ✅ Saved ${menuItems.length} menu items`);
      successCount++;
    }
    
    // Rate limit - be nice to Grab
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Complete!`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ Success: ${successCount}`);
  console.log(`⚠️  Rate limited: ${rateLimitCount}`);
  console.log(`❌ Failed: ${failureCount}`);
  console.log(`${'='.repeat(60)}\n`);
}

async function main() {
  console.log('🚀 Extracting Menu Items from Grab\n');
  
  await initSupabase();
  
  // First, extract cookies from the browser
  const cookiesOk = await fetchCookiesFromBrowser();
  if (!cookiesOk) {
    process.exit(1);
  }
  
  await extractMenuItems();
}

main().catch(console.error);