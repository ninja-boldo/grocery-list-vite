import { Routes, Route } from 'react-router-dom';

import App from './App';
import BarcodeScanner from './comp/Scanner';
import MlScanner from './comp/MlScanner';
import ManualAdd from './comp/ManualAdding';

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/scanner" element={<BarcodeScanner />} />
      <Route path='/scanner/ml' element={<MlScanner />} />
      <Route path='/scanner/manual' element={<ManualAdd />} />
    </Routes>
  );
}
