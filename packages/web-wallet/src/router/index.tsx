import { createBrowserRouter, Navigate } from 'react-router-dom';
import App from '../App';
import ProtectedRoute from '../components/ProtectedRoute/ProtectedRoute';
import Home from '../pages/Home';
import Dashboard from '../pages/Dashboard';
import AccountSummary from '../pages/AccountSummary';
import TransferBalance from '../pages/TransferBalance/TransferBalance';
import Receive from '../pages/Receive/Receive';
import { ShieldBalance } from 'src/pages/ShieldBalance/ShieldBalance';
import ShieldedTransfer from '../pages/ShieldedTransfer/ShieldedTransfer';
import Swap from '../pages/Swap/Swap';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: 'dashboard',
        element: (
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        ),
        children: [
          { index: true, element: <Navigate to="shielded-transfer" replace /> },
          { path: 'account-summary', element: <AccountSummary /> },
          { path: 'transfer-balance', element: <TransferBalance /> },
          { path: 'shield-balance', element: <ShieldBalance /> },
          { path: 'receive', element: <Receive /> },
          { path: 'swap', element: <Swap /> },
          { path: 'shielded-transfer', element: <ShieldedTransfer /> },
        ],
      },
    ],
  },
]);

export { router };
