import { Dimensions, Text, View } from 'react-native';

interface DataPoint {
  date: string;
  systolic: number;
  diastolic: number;
}

interface BPChartProps {
  data: DataPoint[];
}

const { width: screenWidth } = Dimensions.get('window');
const chartWidth = screenWidth - 60;
const chartHeight = 150;

export function BPChart({ data }: BPChartProps) {
  if (data.length === 0) {
    return (
      <View className="bg-white rounded-2xl p-4 mx-5 mb-4">
        <Text className="text-center text-gray-500 py-10">ไม่มีข้อมูล</Text>
      </View>
    );
  }

  // Calculate min/max for scaling
  const allValues = data.flatMap((d) => [d.systolic, d.diastolic]);
  const minValue = Math.min(...allValues) - 10;
  const maxValue = Math.max(...allValues) + 10;
  const range = maxValue - minValue;

  // Scale value to chart height
  const scaleY = (value: number) => {
    return chartHeight - ((value - minValue) / range) * chartHeight;
  };

  // Calculate x positions
  const xStep = chartWidth / (data.length - 1 || 1);

  // Generate path points for systolic (top line)
  const systolicPoints = data.map((d, i) => ({
    x: i * xStep,
    y: scaleY(d.systolic),
  }));

  // Generate path points for diastolic (bottom line)
  const diastolicPoints = data.map((d, i) => ({
    x: i * xStep,
    y: scaleY(d.diastolic),
  }));

  // Y-axis labels
  const yLabels = [maxValue, Math.round((maxValue + minValue) / 2), minValue];

  return (
    <View className="bg-white rounded-2xl p-4 mx-5 mb-4">
      <Text className="text-[11px] text-gray-400 mb-1">mmHg</Text>
      
      <View className="flex-row">
        {/* Y-axis labels */}
        <View
          className="w-[30px] items-end justify-between pr-2"
          style={{ height: chartHeight }}
        >
          {yLabels.map((label, i) => (
            <Text key={i} className="text-[10px] text-gray-400">
              {label}
            </Text>
          ))}
        </View>

        {/* Chart */}
        <View className="flex-1" style={{ height: chartHeight + 30 }}>
          {/* Grid lines */}
          {yLabels.map((_, i) => (
            <View
              key={i}
              className="absolute left-0 right-0 h-px bg-gray-200"
              style={{ top: (i / (yLabels.length - 1)) * chartHeight }}
            />
          ))}

          {/* Lines and points */}
          <View className="absolute top-0 left-0 right-0" style={{ height: chartHeight }}>
            {/* Systolic line (green/teal) */}
            {systolicPoints.map((point, i) => (
              <View key={`sys-${i}`}>
                {i < systolicPoints.length - 1 && (
                  <View
                    className="absolute h-[2px] bg-primary"
                    style={{
                      left: point.x,
                      top: point.y,
                      width: Math.sqrt(
                        Math.pow(xStep, 2) +
                          Math.pow(systolicPoints[i + 1].y - point.y, 2)
                      ),
                      transform: [
                        {
                          rotate: `${Math.atan2(
                            systolicPoints[i + 1].y - point.y,
                            xStep
                          )}rad`,
                        },
                      ],
                    }}
                  />
                )}
                <View
                  className="absolute w-2 h-2 rounded-full bg-primary"
                  style={{ left: point.x - 4, top: point.y - 4 }}
                />
              </View>
            ))}

            {/* Diastolic line (purple) */}
            {diastolicPoints.map((point, i) => (
              <View key={`dia-${i}`}>
                {i < diastolicPoints.length - 1 && (
                  <View
                    className="absolute h-[2px] bg-secondary"
                    style={{
                      left: point.x,
                      top: point.y,
                      width: Math.sqrt(
                        Math.pow(xStep, 2) +
                          Math.pow(diastolicPoints[i + 1].y - point.y, 2)
                      ),
                      transform: [
                        {
                          rotate: `${Math.atan2(
                            diastolicPoints[i + 1].y - point.y,
                            xStep
                          )}rad`,
                        },
                      ],
                    }}
                  />
                )}
                <View
                  className="absolute w-2 h-2 rounded-full bg-secondary"
                  style={{ left: point.x - 4, top: point.y - 4 }}
                />
              </View>
            ))}

            {/* Show latest value tooltip */}
            {data.length > 0 && (
              <View
                className="absolute bg-gray-700 rounded-lg px-2 py-1"
                style={{
                  left: systolicPoints[systolicPoints.length - 1].x - 25,
                  top:
                    (systolicPoints[systolicPoints.length - 1].y +
                      diastolicPoints[diastolicPoints.length - 1].y) /
                      2 -
                    12,
                }}
              >
                <Text className="text-white text-[11px] font-semibold">
                  {data[data.length - 1].systolic}/{data[data.length - 1].diastolic}
                </Text>
              </View>
            )}
          </View>

          {/* X-axis labels */}
          <View className="absolute bottom-0 left-0 right-0 h-5">
            {data.map((d, i) => (
              <Text
                key={i}
                className="absolute text-[10px] text-gray-400 w-[30px] text-center"
                style={{ left: i * xStep - 15 }}
              >
                {d.date}
              </Text>
            ))}
          </View>
        </View>
      </View>

      {/* Legend */}
      <View className="flex-row justify-center gap-5 mt-2">
        <View className="flex-row items-center gap-[6px]">
          <View className="w-2 h-2 rounded-full bg-primary" />
          <Text className="text-[11px] text-gray-500">Systolic</Text>
        </View>
        <View className="flex-row items-center gap-[6px]">
          <View className="w-2 h-2 rounded-full bg-secondary" />
          <Text className="text-[11px] text-gray-500">Diastolic</Text>
        </View>
      </View>
    </View>
  );
}
