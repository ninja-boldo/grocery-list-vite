import { Routes, Route } from 'react-router-dom';

import App from './App';
import BarcodeScanner from './comp/ImprovedScanner';
import ImprovedScanner from './comp/ImprovedScanner';
import MlScanner from './comp/MlScanner';
import ManualAdd from './comp/ManualAdding';
import WishList from './sites/WishList';
import GroupedItems from './sites/GroupedItems';

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/scanner" element={<ImprovedScanner />} />
      <Route path="/scanner/legacy" element={<BarcodeScanner />} />
      <Route path='/scanner/ml' element={<MlScanner />} />
      <Route path='/scanner/manual' element={<ManualAdd />} />
      <Route path='/wish_list' element={<WishList />} />
      <Route path='/matched_items' element={<GroupedItems />} />
    </Routes>
  );
}
