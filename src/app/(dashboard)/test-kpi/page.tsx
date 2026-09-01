import { KpiCard } from "@/features/analytics/components/kpi-card";

export default function TestKpiPage() {
  // Sample data: orange mostly, some dim gray.
  // We want sparklines. Let's make an array.
  const dataRevenue = [
    { value: 10, color: "#404040" },
    { value: 15, color: "#f97316" },
    { value: 8, color: "#404040" },
    { value: 20, color: "#f97316" },
    { value: 25, color: "#f97316" },
    { value: 18, color: "#404040" },
    { value: 30, color: "#f97316" },
    { value: 35, color: "#f97316" },
    { value: 20, color: "#404040" },
    { value: 15, color: "#404040" },
    { value: 40, color: "#f97316" },
    { value: 45, color: "#f97316" },
  ];

  const dataCustomers = [
    { value: 5, color: "#404040" },
    { value: 10, color: "#404040" },
    { value: 8, color: "#404040" },
    { value: 15, color: "#404040" },
    { value: 20, color: "#404040" },
    { value: 12, color: "#404040" },
    { value: 25, color: "#404040" },
    { value: 30, color: "#404040" },
    { value: 18, color: "#404040" },
    { value: 15, color: "#404040" },
    { value: 22, color: "#404040" },
    { value: 28, color: "#f97316" }, // Highlight last one
  ];

  return (
    <div className="p-8 bg-[#121316] min-h-screen">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
        <KpiCard
          title="TOTAL REVENUE"
          value="$20,320"
          trend="0.94"
          trendLabel="last year"
          trendDirection="up"
          data={dataRevenue}
          defaultChartColor="#f97316"
        />
        <KpiCard
          title="TOTAL ORDERS"
          value="10,320"
          trend="0.94"
          trendLabel="last year"
          trendDirection="up"
          data={dataRevenue}
          defaultChartColor="#f97316"
        />
        <KpiCard
          title="NEW CUSTOMERS"
          value="4,305"
          trend="0.94"
          trendLabel="last year"
          trendDirection="up"
          data={dataCustomers}
          defaultChartColor="#f97316"
        />
        <KpiCard
          title="CONVERSION RATE"
          value="3.9%"
          trend="0.94"
          trendLabel="last year"
          trendDirection="up"
          data={dataCustomers}
          defaultChartColor="#f97316"
        />
      </div>
    </div>
  );
}
