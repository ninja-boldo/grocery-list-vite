import { Routes, Route } from 'react-router-dom';
import React, { Suspense } from 'react';
import App from './App';

const WishList        = React.lazy(() => import("./sites/WishList")); 
const ManualAdd       = React.lazy(() => import("./comp/scanning/ManualAdding")); 
const GeoSupermarkets = React.lazy(() => import("./sites/GeoSupermarkets")); 
const ImprovedScanner = React.lazy(() => import("./comp/scanning/ImprovedScanner")); 

const PageLoader = () => <div>Loading...</div>;

export default function AppRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/"               element={<App />} />
        <Route path='/wish_list'      element={<WishList />} />
        <Route path='/scanner/manual' element={<ManualAdd />} />
        <Route path='/market_mapping' element={<GeoSupermarkets />} />
        <Route path="/scanner"        element={<ImprovedScanner />} />
      </Routes>
    </Suspense>
  );
}