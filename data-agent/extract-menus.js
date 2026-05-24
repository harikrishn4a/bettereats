#!/usr/bin/env node

import puppeteer from 'puppeteer-core';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

let supabase;

async function initSupabase() {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('✅ Supabase connected\n');
}

async function connectToExistingBrowser() {
  const response = await fetch('http://127.0.0.1:9222/json/version');
  const data = await response.json();
  const wsEndpoint = data.webSocketDebuggerUrl;

  const browser = await puppeteer.connect({
    browserWSEndpoint: wsEndpoint,
  });

  return browser;
}

async function extractMenuFromPage(page, restaurantId) {
  // Wait for menu items to load
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Use the EXACT extraction logic from the working console script
  const menuItems = await page.evaluate(() => {
    const cards = [];
    const allDivs = Array.from(document.querySelectorAll('div'));
    
    allDivs.forEach(div => {
      try {
        const text = (div.innerText || '').trim();
        
        if (text.length < 15 || text.length > 400) return;
        
        const priceMatch = text.match(/S?\$?\s*(\d+\.?\d*)/);
        if (!priceMatch) return;
        
        const price = parseFloat(priceMatch[1]);
        
        if (price < 2 || price > 50) return;
        
        const noisePatterns = [
          /^\d+\s+Jalan/,
          /^For orders/,
          /Opening Hours/,
          /Deliver (to|date|time)/,
          /mins?\s*•/,
          /km\s*(away)?$/,
          /^\d+\.\d+$/
        ];
        
        if (noisePatterns.some(pattern => pattern.test(text))) return;
        
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        if (lines.length === 0) return;
        
        const name = lines[0];
        
        if (name.length < 4 || /^[\d\s.,•]+$/.test(name)) return;
        if (/Singapore|Restaurant|Home|Delivery|Rating/.test(name)) return;
        
        const description = lines
          .slice(1)
          .filter(l => !l.match(/^\d+\.?\d*$/) && !l.includes('$') && l.length > 5)
          .join(' ');
        
        const key = `${name}|${price}`;
        
        cards.push({
          name: name.substring(0, 150),
          description: description.substring(0, 250),
          price: parseFloat(price.toFixed(2)),
          key: key
        });
      } catch (e) {}
    });
    
    const seen = new Set();
    const unique = [];
    
    cards.forEach(card => {
      if (!seen.has(card.key)) {
        unique.push({
          name: card.name,
          description: card.description,
          price: card.price
        });
        seen.add(card.key);
      }
    });
    
    return unique;
  });

  return menuItems;
}

async function scrapeRestaurantMenu(restaurant, index, total) {
  console.log(`\n[${index}/${total}] ${restaurant.name}`);
  console.log(`  🔗 URL: ${restaurant.grab_url}`);
  
  let browser;
  let page;
  
  try {
    browser = await connectToExistingBrowser();
    page = await browser.newPage();
    
    // Navigate to restaurant
    await page.goto(restaurant.grab_url, { waitUntil: 'networkidle2', timeout: 15000 });
    console.log(`  ✅ Page loaded`);
    
    // Extract menu from DOM
    const menuItems = await extractMenuFromPage(page, restaurant.id);
    console.log(`  🍽️  Found ${menuItems.length} menu items`);
    
    if (menuItems.length > 0) {
      const first3 = menuItems.slice(0, 3).map(m => `${m.name} ($${m.price})`).join(', ');
      console.log(`  📋 First 3: ${first3}`);
      
      // Prepare for insert
      const itemsToInsert = menuItems.map(item => ({
        restaurant_id: restaurant.id,
        name: item.name.substring(0, 255),
        description: item.description.substring(0, 1000),
        price: item.price,
        dietary_tags: [],
        health_score: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));
      
      // Insert into Supabase
      const { error } = await supabase
        .from('menu_items')
        .insert(itemsToInsert);
      
      if (error) {
        if (!error.message.includes('duplicate')) {
          console.log(`  ❌ Save error: ${error.message}`);
          return { success: false, error: 'save_error' };
        }
        console.log(`  ✅ Saved ${menuItems.length} items (some duplicates)`);
      } else {
        console.log(`  ✅ Saved ${menuItems.length} items`);
      }
      
      return { success: true, items: menuItems.length };
    } else {
      console.log(`  ⚠️  No menu items found`);
      return { success: false, error: 'no_items' };
    }
  } catch (error) {
    console.log(`  ❌ Error: ${error.message.substring(0, 100)}`);
    return { success: false, error: error.message };
  } finally {
    if (page) await page.close();
    if (browser) await browser.disconnect();
  }
}

async function main() {
  console.log('🚀 Extracting Menus via Browser Scraping\n');
  
  await initSupabase();
  
  // Get restaurants
  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, name, grab_url')
    .limit(1000);
  
  if (error) {
    console.error('❌ Failed to fetch restaurants:', error.message);
    process.exit(1);
  }
  
  console.log(`📍 Found ${restaurants.length} restaurants\n`);
  
  let successCount = 0;
  let failureCount = 0;
  
  for (let i = 0; i < restaurants.length; i++) {
    const result = await scrapeRestaurantMenu(restaurants[i], i + 1, restaurants.length);
    
    if (result.success) {
      successCount++;
    } else {
      failureCount++;
    }
    
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Complete!`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failureCount}`);
  console.log(`${'='.repeat(60)}\n`);
}

main().catch(console.error);