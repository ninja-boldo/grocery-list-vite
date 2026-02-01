import { Routes, Route } from 'react-router-dom';

import React, { Suspense } from 'react';
import App from './App';
import GroupedItems from "./sites/GroupedItems"; 
import WishList from "./sites/WishList"; 
import ManualAdd from "./comp/scanning/ManualAdding"; 
import GeoSupermarkets from './sites/GeoSupermarkets';

// Lazy load the HEAVY stuff
const ImprovedScanner = React.lazy(() => import("./comp/scanning/ImprovedScanner")); 
const MlScanner = React.lazy(() => import("./comp/scanning/MlScanner")); 


export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route path='/matched_items' element={<GroupedItems />} />
      <Route path='/wish_list' element={<WishList />} />
      <Route path='/scanner/manual' element={<ManualAdd />} />
      <Route path='/market_mapping' element={<GeoSupermarkets />} />
      
      {/* Only lazy load the heavy ones */}
      <Route path="/scanner" element={
        <Suspense fallback={<div>Loading scanner...</div>}>
          <ImprovedScanner />
        </Suspense>
      } />
      <Route path='/scanner/ml' element={
        <Suspense fallback={<div>Loading ML scanner...</div>}>
          <MlScanner />
        </Suspense>
      } />
    </Routes>
  );
}