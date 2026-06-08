import { getOrderHistory } from "@/features/orders/order.actions";
import OrderHistoryTable from "@/components/OrderHistoryTable";
import { History } from "lucide-react";

export default async function OrdersPage() {
  const orders = await getOrderHistory();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-yellow-400" />
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Order History</h1>
          <p className="text-sm text-gray-500 mt-0.5">All your trades across Zerodha and Alpaca</p>
        </div>
      </div>

      <OrderHistoryTable orders={orders} />
    </div>
  );
}
