(function () {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();
  var red = style.getPropertyValue('--red').trim();
  var orange = style.getPropertyValue('--orange').trim();
  var yellow = style.getPropertyValue('--yellow').trim();
  var green = style.getPropertyValue('--green').trim();

  // --- Chart 1: Issue Severity Distribution (Pie) ---
  var chart1 = echarts.init(document.getElementById('chart-issues'), null, { renderer: 'svg' });
  chart1.setOption({
    animation: false,
    tooltip: { trigger: 'item', appendToBody: true, formatter: '{b}: {c} 个 ({d}%)' },
    legend: { bottom: 10, left: 'center', textStyle: { color: muted, fontSize: 13 } },
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '42%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: bg2, borderWidth: 3 },
      label: { show: true, position: 'inside', formatter: '{c}', fontSize: 18, fontWeight: 700, color: '#fff' },
      labelLine: { show: false },
      data: [
        { value: 3, name: 'P0 阻塞', itemStyle: { color: red } },
        { value: 7, name: 'P1 重要', itemStyle: { color: orange } },
        { value: 6, name: 'P2 建议', itemStyle: { color: yellow } }
      ]
    }]
  });
  window.addEventListener('resize', function () { chart1.resize(); });

  // --- Chart 2: Schedule Comparison (Bar) ---
  var chart2 = echarts.init(document.getElementById('chart-schedule'), null, { renderer: 'svg' });
  chart2.setOption({
    animation: false,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, appendToBody: true },
    legend: { bottom: 0, textStyle: { color: muted, fontSize: 13 } },
    grid: { left: 80, right: 30, top: 30, bottom: 50 },
    xAxis: { type: 'value', axisLabel: { color: muted, fontSize: 12 }, splitLine: { lineStyle: { color: rule } }, axisLine: { lineStyle: { color: rule } } },
    yAxis: {
      type: 'category',
      data: ['Phase 0', 'Phase 1', 'Phase 2', 'Phase 3', '缓冲'],
      axisLabel: { color: ink, fontSize: 13, fontWeight: 700 },
      axisLine: { lineStyle: { color: rule } }
    },
    series: [
      {
        name: '原排期 (12天)',
        type: 'bar',
        data: [2, 3, 4, 3, 0],
        itemStyle: { color: muted, borderRadius: [0, 6, 6, 0] },
        barWidth: 22,
        label: { show: true, position: 'right', color: muted, fontSize: 12, formatter: '{c} 天' }
      },
      {
        name: '建议排期 (14天)',
        type: 'bar',
        data: [2, 4, 4, 4, 2],
        itemStyle: {
          color: function (params) {
            var colors = [accent, accent, accent, orange, green];
            return colors[params.dataIndex];
          },
          borderRadius: [0, 6, 6, 0]
        },
        barWidth: 22,
        label: { show: true, position: 'right', color: ink, fontSize: 12, fontWeight: 700, formatter: '{c} 天' }
      }
    ]
  });
  window.addEventListener('resize', function () { chart2.resize(); });

  // --- Mermaid Init ---
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose' });
  }
})();
