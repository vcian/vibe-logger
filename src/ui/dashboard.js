(function initDashboard() {
  const state = {
    search: '',
    level: '',
    source: '',
    startDate: '',
    endDate: '',
    draftStartDate: '',
    draftEndDate: '',
    datePreset: '',
    pageSize: 25,
    page: 1,
    total: 0,
    chartHour: '',
    expandedId: '',
    logs: [],
  };

  const els = {
    loading: document.getElementById('loadingOverlay'),
    search: document.getElementById('searchInput'),
    level: document.getElementById('levelSelect'),
    source: document.getElementById('sourceSelect'),
    startDate: document.getElementById('startDate'),
    endDate: document.getElementById('endDate'),
    applyDate: document.getElementById('applyDateBtn'),
    cancelDate: document.getElementById('cancelDateBtn'),
    clearDate: document.getElementById('clearDateBtn'),
    dateValidation: document.getElementById('dateValidationMsg'),
    datePresetButtons: Array.from(document.querySelectorAll('.date-preset-btn')),
    clear: document.getElementById('clearFiltersBtn'),
    exportCsv: document.getElementById('exportCsvBtn'),
    chips: document.getElementById('chips'),
    body: document.getElementById('tableBody'),
    empty: document.getElementById('emptyState'),
    pageLabel:
      document.getElementById('paginationInfo') || document.getElementById('paginationLabel'),
    prev: document.getElementById('prevBtn'),
    next: document.getElementById('nextBtn'),
    pageSize: document.getElementById('perPageSelect') || document.getElementById('pageSizeSelect'),
    toast: document.getElementById('toast'),
    metricTotal: document.getElementById('metricTotal'),
    metricError: document.getElementById('metricError'),
    metricWarn: document.getElementById('metricWarn'),
    metricInfo: document.getElementById('metricInfo'),
    metricErrorRate: document.getElementById('metricErrorRate'),
    metricWarnRate: document.getElementById('metricWarnRate'),
    topSources: document.getElementById('topSourcesList'),
    topErrors: document.getElementById('topErrorsList'),
    spikeHours: document.getElementById('spikeHoursList'),
    logout: document.getElementById('logoutBtn'),
    username: document.getElementById('usernameLabel'),
  };

  let chart = null;
  let minBarPluginRegistered = false;
  let debounceTimer = null;
  let toastTimer = null;
  let initialLoadComplete = false;
  /** Incremented on each fetchLogs; stale responses must not overwrite UI. */
  let logsFetchGeneration = 0;
  let fpStart = null;
  let fpEnd = null;

  const minBarHeightPlugin = {
    id: 'minBarHeight',
    afterDatasetsDraw(chartInstance) {
      const { ctx } = chartInstance;
      chartInstance.data.datasets.forEach((dataset, datasetIndex) => {
        const meta = chartInstance.getDatasetMeta(datasetIndex);
        if (meta.hidden) return;
        meta.data.forEach((bar, index) => {
          const value = Number(dataset.data[index] || 0);
          if (value > 0 && bar && typeof bar.height === 'number' && bar.height < 4) {
            const x = bar.x;
            const y = bar.y;
            const width = bar.width;
            ctx.save();
            ctx.fillStyle = dataset.backgroundColor;
            ctx.fillRect(x - width / 2, y - 4, width, 4);
            ctx.restore();
          }
        });
      });
    },
  };

  function initDatePickers() {
    if (typeof flatpickr !== 'function') return;
    const baseConfig = {
      enableTime: true,
      time_24hr: true,
      dateFormat: 'Y-m-d\\TH:i',
      allowInput: true,
      minuteIncrement: 1,
      disableMobile: true,
      monthSelectorType: 'static',
      position: 'auto center',
    };
    fpStart = flatpickr(els.startDate, {
      ...baseConfig,
      onChange: function () {
        state.draftStartDate = els.startDate.value;
        setPresetActive('custom');
        setDateValidation('');
      },
    });
    fpEnd = flatpickr(els.endDate, {
      ...baseConfig,
      onChange: function () {
        state.draftEndDate = els.endDate.value;
        setPresetActive('custom');
        setDateValidation('');
      },
    });
  }

  function setPickerValue(picker, value) {
    if (!picker) return;
    if (value) {
      picker.setDate(value, false);
    } else {
      picker.clear(false);
    }
  }

  function showLoading(show) {
    els.loading.classList.toggle('hidden', !show);
  }

  function showToast(message, isError) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    els.toast.classList.toggle('error', Boolean(isError));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 3000);
  }

  function setDateValidation(message) {
    els.dateValidation.textContent = message || '';
    els.dateValidation.classList.toggle('hidden', !message);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => {
      if (character === '&') return '&amp;';
      if (character === '<') return '&lt;';
      if (character === '>') return '&gt;';
      if (character === '"') return '&quot;';
      return '&#39;';
    });
  }

  function queryString(includePaging) {
    const params = new URLSearchParams();
    if (state.search) params.set('search', state.search);
    if (state.level) params.set('level', state.level);
    if (state.source) params.set('source', state.source);
    if (state.startDate) params.set('startDate', new Date(state.startDate).toISOString());
    if (state.endDate) params.set('endDate', new Date(state.endDate).toISOString());
    if (state.chartHour) {
      params.set('startDate', state.chartHour);
      const end = new Date(state.chartHour);
      end.setHours(end.getHours() + 1);
      params.set('endDate', end.toISOString());
    }
    if (includePaging) {
      params.set('limit', String(state.pageSize));
      params.set('offset', String((state.page - 1) * state.pageSize));
    }
    return params.toString();
  }

  function highlight(text) {
    const safeText = escapeHtml(text);
    if (!state.search) return safeText;
    const escaped = state.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safeText.replace(new RegExp(`(${escaped})`, 'ig'), '<mark>$1</mark>');
  }

  function badge(level) {
    return `<span class="badge badge-${level}">${level.toUpperCase()}</span>`;
  }

  function renderChips() {
    const chips = [];
    if (state.search) chips.push(['search', `Search: ${state.search}`]);
    if (state.level) chips.push(['level', `Level: ${state.level}`]);
    if (state.source) chips.push(['source', `Source: ${state.source}`]);
    if (state.startDate) chips.push(['startDate', `From: ${state.startDate}`]);
    if (state.endDate) chips.push(['endDate', `To: ${state.endDate}`]);
    if (state.chartHour)
      chips.push(['chartHour', `Hour: ${new Date(state.chartHour).toLocaleString()}`]);
    els.chips.innerHTML = chips
      .map(([key, label]) => `<button class="chip" data-key="${key}">${label} x</button>`)
      .join('');
  }

  function hasActiveFilters() {
    return !!(state.search || state.level || state.source || state.startDate || state.endDate || state.chartHour);
  }

  function renderTable() {
    if (!state.logs.length) {
      els.body.innerHTML = '';
      if (hasActiveFilters()) {
        els.empty.innerHTML = `
          <div class="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="8" stroke="#d1d5db" stroke-width="1.5"/>
              <path d="M21 21l-4.35-4.35" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M8 11h6M11 8v6" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="empty-state-title">No logs match your filters</div>
          <div class="empty-state-desc">Try adjusting or <button class="empty-state-action" id="emptyStateClearBtn">clearing your filters</button></div>`;
        const clearBtn = document.getElementById('emptyStateClearBtn');
        if (clearBtn) clearBtn.addEventListener('click', () => els.clear.click());
      } else {
        els.empty.innerHTML = `
          <div class="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="#d1d5db" stroke-width="1.5"/>
              <path d="M7 8h10M7 12h7M7 16h5" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="empty-state-title">No logs yet</div>
          <div class="empty-state-desc">Logs will appear here once your application starts generating them</div>`;
      }
      els.empty.classList.remove('hidden');
      return;
    }
    els.empty.classList.add('hidden');
    const rows = [];
    for (const log of state.logs) {
      const errorRow = log.level === 'error' ? 'error-row' : '';
      const fullMessage = String(log.message == null ? '' : log.message);
      const firstLine = fullMessage.split(/\r?\n/)[0];
      const hasMore = fullMessage.length > firstLine.length;
      const expanded = state.expandedId === log.id;
      const rowClasses = [errorRow, expanded ? 'is-expanded' : ''].filter(Boolean).join(' ');
      const caret = hasMore
        ? '<span class="message-caret" aria-hidden="true">&#9656;</span>'
        : '<span class="message-caret is-placeholder" aria-hidden="true"></span>';
      rows.push(`
        <tr class="${rowClasses}" data-id="${log.id}">
          <td>${new Date(log.timestamp).toLocaleString()}</td>
          <td>${badge(log.level)}</td>
          <td>${escapeHtml(log.source || '-')}</td>
          <td class="message"><div class="message-cell">${caret}<span class="message-text" title="${escapeHtml(firstLine)}">${highlight(firstLine)}</span></div></td>
        </tr>
      `);
      if (expanded) {
        const hasMeta =
          log.meta && typeof log.meta === 'object' && Object.keys(log.meta).length > 0;
        const blocks = [];
        if (hasMore) {
          blocks.push(
            `<div class="detail-block"><div class="detail-label">Full message</div><pre class="detail-pre">${escapeHtml(fullMessage)}</pre></div>`
          );
        }
        if (hasMeta) {
          blocks.push(
            `<div class="detail-block"><div class="detail-label">Metadata</div><pre class="detail-pre">${escapeHtml(JSON.stringify(log.meta, null, 2))}</pre></div>`
          );
        }
        const detailHtml = blocks.length
          ? blocks.join('')
          : '<div class="detail-empty">No additional details</div>';
        rows.push(`<tr class="meta-row"><td colspan="4">${detailHtml}</td></tr>`);
      }
    }
    els.body.innerHTML = rows.join('');
  }

  function renderPageNumbers(currentPage, totalPages) {
    const container = document.getElementById('pageNumbers');
    if (!container) return;
    container.innerHTML = '';
    if (totalPages <= 0) return;

    let pages = [];
    if (totalPages <= 7) {
      pages = Array.from({ length: totalPages }, (_, i) => i + 1);
    } else if (currentPage <= 4) {
      pages = [1, 2, 3, 4, 5, '...', totalPages];
    } else if (currentPage >= totalPages - 3) {
      pages = [
        1,
        '...',
        totalPages - 4,
        totalPages - 3,
        totalPages - 2,
        totalPages - 1,
        totalPages,
      ];
    } else {
      pages = [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
    }

    pages.forEach(page => {
      if (page === '...') {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'page-ellipsis';
        ellipsis.textContent = '...';
        container.appendChild(ellipsis);
      } else {
        const btn = document.createElement('button');
        btn.className = `page-number-btn${page === currentPage ? ' active' : ''}`;
        btn.textContent = String(page);
        btn.onclick = () => goToPage(page);
        container.appendChild(btn);
      }
    });
  }

  function updatePaginationInfo(currentPage, perPage, total) {
    const start = total === 0 ? 0 : (currentPage - 1) * perPage + 1;
    const end = Math.min(currentPage * perPage, total);
    const infoEl = document.getElementById('paginationInfo');
    if (infoEl) {
      infoEl.innerHTML = `Showing <strong>${start}-${end}</strong> of <strong>${total}</strong> entries`;
    } else if (els.pageLabel) {
      els.pageLabel.textContent = `Showing ${start}-${end} of ${total} entries`;
    }

    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const totalPages = Math.ceil(total / perPage);

    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

    renderPageNumbers(currentPage, totalPages);
  }

  function goToPage(page) {
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    const nextPage = Math.min(Math.max(1, Number(page)), totalPages);
    if (nextPage === state.page) return;
    state.page = nextPage;
    fetchLogs();
  }

  function changePage(direction) {
    if (direction === 'prev' && state.page > 1) {
      state.page -= 1;
      fetchLogs();
      return;
    }
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    if (direction === 'next' && state.page < totalPages) {
      state.page += 1;
      fetchLogs();
    }
  }

  function renderPagination() {
    updatePaginationInfo(state.page, state.pageSize, state.total);
  }

  function renderStats(data) {
    els.metricTotal.textContent = String(data.total || 0);
    els.metricError.textContent = String(data.byLevel?.error || 0);
    els.metricWarn.textContent = String(data.byLevel?.warn || 0);
    els.metricInfo.textContent = String(data.byLevel?.info || 0);
    els.metricErrorRate.textContent = `${data.errorRate || 0}%`;
    els.metricWarnRate.textContent = `Warn rate: ${data.warnRate || 0}%`;
  }

  function renderInsights(data) {
    const previewText = (value, maxLen) => {
      const normalized = String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (normalized.length <= maxLen) {
        return normalized;
      }
      return `${normalized.slice(0, maxLen - 1)}...`;
    };

    const topSources = data.topNoisySources || [];
    if (!topSources.length) {
      els.topSources.innerHTML = '<li class="muted">No data yet</li>';
    } else {
      els.topSources.innerHTML = topSources
        .map(source => {
          return `<li><span class="insight-main">${escapeHtml(source.source)}</span><span class="insight-side">${source.total} logs (${source.errorRate}% errors)</span></li>`;
        })
        .join('');
    }

    const topErrors = data.topErrorMessages || [];
    if (!topErrors.length) {
      els.topErrors.innerHTML = '<li class="muted">No data yet</li>';
    } else {
      els.topErrors.innerHTML = topErrors
        .map(item => {
          const compactMessage = previewText(item.message, 320);
          const sourceHint = item.sources?.length
            ? ` (${item.sources.length} source${item.sources.length > 1 ? 's' : ''})`
            : '';
          return `<li class="insight-row insight-row--error" title="${escapeHtml(item.message)}"><span class="insight-main">${escapeHtml(compactMessage)}</span><span class="insight-side">${item.count}x${sourceHint}</span></li>`;
        })
        .join('');
    }

    const spikes = data.spikeHours || [];
    if (!spikes.length) {
      els.spikeHours.innerHTML = '<span class="muted">No spikes detected</span>';
    } else {
      els.spikeHours.innerHTML = spikes
        .map(spike => {
          const label = new Date(spike.hour).toLocaleString();
          const count = Number(spike.errorCount ?? 0);
          return `<div class="spike-chip" role="listitem">
            <span class="spike-chip-time">${escapeHtml(label)}</span>
            <span class="spike-chip-badge">${count} error${count === 1 ? '' : 's'}</span>
          </div>`;
        })
        .join('');
    }
  }

  function renderChart(data) {
    const hourBuckets = data.byHour || [];
    const chartHost =
      document.getElementById('chartWrapper') ||
      document.getElementById('logChartContainer') ||
      document.querySelector('.chart-wrap') ||
      document.querySelector('.chart-container');
    const hasData = hourBuckets.some(
      bucket =>
        Number(bucket.info || 0) +
          Number(bucket.warn || 0) +
          Number(bucket.error || 0) +
          Number(bucket.debug || 0) >
        0
    );

    if (chart) {
      chart.destroy();
      chart = null;
    }

    if (!chartHost) return;

    if (!hasData) {
      chartHost.innerHTML = `
        <div style="
          height: 380px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #9CA3AF;
          font-size: 15px;
          font-family: system-ui, sans-serif;
        ">
          <div style="font-size: 36px; margin-bottom: 12px;">📊</div>
          <div style="font-weight: 600; color: #6B7280;">No log data for selected time range</div>
          <div style="font-size: 13px; margin-top: 6px;">Try adjusting your date filter</div>
        </div>`;
      return;
    }

    let canvas = chartHost.querySelector('#logChart, #volumeChart, canvas');
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
      chartHost.innerHTML = '<canvas id="logChart" class="log-chart"></canvas>';
      canvas = chartHost.querySelector('canvas');
    } else if (!canvas.id) {
      canvas.id = 'logChart';
      canvas.classList.add('log-chart');
    }

    function formatChartLabel(isoTimestamp) {
      const date = new Date(isoTimestamp);
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const hours = date.getHours().toString().padStart(2, '0');
      return `${day}/${month} ${hours}:00`;
    }

    const chartLabels = hourBuckets.map(bucket => formatChartLabel(bucket.hour));
    const hourValues = hourBuckets.map(bucket => bucket.hour);
    const infoData = hourBuckets.map(bucket => Number(bucket.info || 0));
    const warnData = hourBuckets.map(bucket => Number(bucket.warn || 0));
    const errorData = hourBuckets.map(bucket => Number(bucket.error || 0));
    const debugData = hourBuckets.map(bucket => Number(bucket.debug || 0));
    const stackTotals = hourBuckets.map(
      bucket =>
        Number(bucket.info || 0) +
        Number(bucket.warn || 0) +
        Number(bucket.error || 0) +
        Number(bucket.debug || 0)
    );
    const maxStack = Math.max(...stackTotals, 0);
    const yStep =
      maxStack <= 10 ? 1 : maxStack <= 50 ? 5 : maxStack <= 100 ? 10 : maxStack <= 500 ? 50 : 100;

    const datasets = [
      {
        label: 'info',
        data: infoData,
        backgroundColor: '#3B82F6',
        hoverBackgroundColor: '#2563EB',
        borderRadius: 3,
        borderSkipped: false,
        categoryPercentage: 0.75,
        barPercentage: 0.85,
      },
      {
        label: 'warn',
        data: warnData,
        backgroundColor: '#F59E0B',
        hoverBackgroundColor: '#D97706',
        borderRadius: 3,
        borderSkipped: false,
        categoryPercentage: 0.75,
        barPercentage: 0.85,
      },
      {
        label: 'error',
        data: errorData,
        backgroundColor: '#EF4444',
        hoverBackgroundColor: '#DC2626',
        borderRadius: 3,
        borderSkipped: false,
        categoryPercentage: 0.75,
        barPercentage: 0.85,
      },
      {
        label: 'debug',
        data: debugData,
        backgroundColor: '#8B5CF6',
        hoverBackgroundColor: '#7C3AED',
        borderRadius: 3,
        borderSkipped: false,
        categoryPercentage: 0.75,
        barPercentage: 0.85,
      },
    ];

    const chartData = { labels: chartLabels, datasets };
    if (!minBarPluginRegistered) {
      Chart.register(minBarHeightPlugin);
      minBarPluginRegistered = true;
    }

    chart = new Chart(canvas, {
      type: 'bar',
      data: chartData,
      plugins: [minBarHeightPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,

        interaction: {
          mode: 'index',
          intersect: false,
        },

        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              color: '#374151',
              font: {
                size: 13,
                family: "'Inter', system-ui, sans-serif",
                weight: '500',
              },
              padding: 20,
              usePointStyle: true,
              pointStyle: 'circle',
              pointStyleWidth: 10,
              boxHeight: 8,
            },
          },
          tooltip: {
            enabled: true,
            backgroundColor: '#1F2937',
            titleColor: '#F9FAFB',
            bodyColor: '#D1D5DB',
            borderColor: '#374151',
            borderWidth: 1,
            padding: 14,
            cornerRadius: 8,
            titleFont: { size: 13, weight: 'bold', family: "'Inter', system-ui, sans-serif" },
            bodyFont: { size: 13, family: "'Inter', system-ui, sans-serif" },
            callbacks: {
              title(items) {
                return items[0].label;
              },
              label(item) {
                return `  ${item.dataset.label}: ${item.parsed.y} logs`;
              },
              footer(items) {
                const total = items.reduce((sum, i) => sum + i.parsed.y, 0);
                return `Total: ${total} logs`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: {
              display: false,
              drawBorder: false,
            },
            border: {
              display: false,
            },
            ticks: {
              color: '#6B7280',
              font: {
                size: 11,
                family: "'Inter', system-ui, sans-serif",
              },
              maxRotation: 40,
              minRotation: 30,
              maxTicksLimit: 14,
              autoSkip: true,
              padding: 8,
              callback(value) {
                const label = this.getLabelForValue(value);
                if (label && label.includes(' ')) {
                  const parts = label.split(' ');
                  const datePart = parts[0] || '';
                  const timePart = parts[1] || '';
                  return `${datePart}\n${timePart}`;
                }
                return label;
              },
            },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: {
              color: '#F3F4F6',
              drawBorder: false,
              lineWidth: 1,
            },
            border: {
              display: false,
            },
            ticks: {
              color: '#6B7280',
              font: {
                size: 12,
                family: "'Inter', system-ui, sans-serif",
              },
              padding: 10,
              stepSize: yStep,
              callback(value) {
                if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
                return value;
              },
            },
          },
        },

        animation: {
          duration: 600,
          easing: 'easeInOutQuart',
        },

        layout: {
          padding: {
            top: 10,
            right: 16,
            bottom: 0,
            left: 0,
          },
        },

        onClick(_event, items) {
          if (!items.length) return;
          const clickedHour = hourValues[items[0].index];
          state.chartHour = state.chartHour === clickedHour ? '' : clickedHour;
          state.page = 1;
          fetchLogs();
        },
      },
    });
  }

  async function fetchStats(forGeneration) {
    const response = await fetch(`./logs/stats?${queryString(false)}`);
    if (forGeneration !== logsFetchGeneration) return;
    if (!response.ok) throw new Error('Unable to load stats');
    const payload = await response.json();
    if (forGeneration !== logsFetchGeneration) return;
    const stats = payload.data || {};
    renderStats(stats);
    renderInsights(stats);
    renderChart(stats);

    const selectedSource = state.source;
    els.source.innerHTML = '<option value="">All Sources</option>';
    (payload.sources || []).forEach(source => {
      const option = document.createElement('option');
      option.value = source;
      option.textContent = source;
      option.selected = source === selectedSource;
      els.source.appendChild(option);
    });
  }

  async function fetchLogs() {
    if (state.startDate && state.endDate && new Date(state.startDate) > new Date(state.endDate)) {
      showToast('Start date must be before end date', true);
      return;
    }
    const myGeneration = ++logsFetchGeneration;
    showLoading(true);
    try {
      const response = await fetch(`./logs?${queryString(true)}`);
      if (myGeneration !== logsFetchGeneration) return;
      if (!response.ok) throw new Error('Unable to load logs');
      const payload = await response.json();
      if (myGeneration !== logsFetchGeneration) return;
      state.logs = payload.data || [];
      state.total = payload.total || 0;
      renderTable();
      renderPagination();
      renderChips();
      await fetchStats(myGeneration);
    } catch (error) {
      if (myGeneration !== logsFetchGeneration) return;
      showToast(error.message || 'Failed to fetch logs', true);
    } finally {
      if (myGeneration === logsFetchGeneration) {
        showLoading(false);
        if (!initialLoadComplete) {
          initialLoadComplete = true;
          els.loading.classList.add('soft');
        }
      }
    }
  }

  function syncStateFromInputs() {
    state.search = els.search.value.trim();
    state.level = els.level.value;
    state.source = els.source.value;
    state.pageSize = Number(els.pageSize.value || '25');
  }

  function toLocalInputValue(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function setPresetActive(preset) {
    state.datePreset = preset;
    els.datePresetButtons.forEach(button => {
      button.classList.toggle('active', button.dataset.range === preset);
    });
    const customPanel = document.getElementById('dateCustomPanel');
    if (customPanel) {
      customPanel.classList.toggle('hidden', preset !== 'custom');
    }
  }

  function syncDraftInputsFromState() {
    setPickerValue(fpStart, state.startDate);
    setPickerValue(fpEnd, state.endDate);
    state.draftStartDate = state.startDate;
    state.draftEndDate = state.endDate;
  }

  function applyDraftDateRange() {
    const draftStart = state.draftStartDate;
    const draftEnd = state.draftEndDate;
    if ((draftStart && !draftEnd) || (!draftStart && draftEnd)) {
      setDateValidation('Select both start and end date/time.');
      return;
    }
    if (draftStart && draftEnd && new Date(draftStart) > new Date(draftEnd)) {
      setDateValidation('Start date must be before end date.');
      return;
    }

    setDateValidation('');
    state.startDate = draftStart;
    state.endDate = draftEnd;
    state.chartHour = '';
    setPresetActive('custom');
    state.page = 1;
    fetchLogs();
  }

  function applyPreset(range) {
    if (range === 'custom') {
      setPresetActive('custom');
      setDateValidation('');
      return;
    }
    const end = new Date();
    const start = new Date(end.getTime());
    if (range === '1h') start.setHours(start.getHours() - 1);
    if (range === '24h') start.setHours(start.getHours() - 24);
    if (range === '7d') start.setDate(start.getDate() - 7);

    state.startDate = toLocalInputValue(start);
    state.endDate = toLocalInputValue(end);
    state.draftStartDate = state.startDate;
    state.draftEndDate = state.endDate;
    setPickerValue(fpStart, state.startDate);
    setPickerValue(fpEnd, state.endDate);
    state.chartHour = '';
    setDateValidation('');
    setPresetActive(range);
    state.page = 1;
    fetchLogs();
  }

  function onFilterInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      syncStateFromInputs();
      state.page = 1;
      fetchLogs();
    }, 300);
  }

  window.goToPage = goToPage;
  window.changePage = changePage;

  els.search.addEventListener('input', onFilterInput);
  els.level.addEventListener('change', onFilterInput);
  els.source.addEventListener('change', onFilterInput);
  els.startDate.addEventListener('keydown', event => {
    if (event.key === 'Enter') applyDraftDateRange();
    if (event.key === 'Escape') syncDraftInputsFromState();
  });
  els.endDate.addEventListener('keydown', event => {
    if (event.key === 'Enter') applyDraftDateRange();
    if (event.key === 'Escape') syncDraftInputsFromState();
  });
  els.applyDate.addEventListener('click', applyDraftDateRange);
  els.cancelDate.addEventListener('click', () => {
    syncDraftInputsFromState();
    setDateValidation('');
  });
  els.clearDate.addEventListener('click', () => {
    state.startDate = '';
    state.endDate = '';
    state.draftStartDate = '';
    state.draftEndDate = '';
    state.chartHour = '';
    setPickerValue(fpStart, '');
    setPickerValue(fpEnd, '');
    setPresetActive('');
    setDateValidation('');
    state.page = 1;
    fetchLogs();
  });
  els.datePresetButtons.forEach(button => {
    button.addEventListener('click', () => applyPreset(button.dataset.range || ''));
  });
  els.pageSize.addEventListener('change', () => {
    syncStateFromInputs();
    state.page = 1;
    fetchLogs();
  });

  els.clear.addEventListener('click', () => {
    state.search = '';
    state.level = '';
    state.source = '';
    state.startDate = '';
    state.endDate = '';
    state.chartHour = '';
    state.draftStartDate = '';
    state.draftEndDate = '';
    els.search.value = '';
    els.level.value = '';
    els.source.value = '';
    setPickerValue(fpStart, '');
    setPickerValue(fpEnd, '');
    setPresetActive('');
    setDateValidation('');
    state.page = 1;
    fetchLogs();
  });

  els.chips.addEventListener('click', event => {
    const button = event.target.closest('.chip');
    if (!button) return;
    const key = button.getAttribute('data-key');
    state[key] = '';
    if (key === 'startDate' || key === 'endDate') {
      state.startDate = '';
      state.endDate = '';
      state.draftStartDate = '';
      state.draftEndDate = '';
      setPickerValue(fpStart, '');
      setPickerValue(fpEnd, '');
      setPresetActive('');
      setDateValidation('');
    } else if (els[key]) {
      els[key].value = '';
    }
    state.page = 1;
    fetchLogs();
  });

  els.body.addEventListener('click', event => {
    const row = event.target.closest('tr[data-id]');
    if (!row) return;
    state.expandedId = state.expandedId === row.dataset.id ? '' : row.dataset.id;
    renderTable();
  });

  els.exportCsv.addEventListener('click', async () => {
    try {
      const response = await fetch(`./logs/export/csv?${queryString(false)}`);
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const link = document.createElement('a');
      const filename = `logs-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      showToast('CSV export complete', false);
    } catch (error) {
      showToast(error.message || 'Export failed', true);
    }
  });

  // Auth UI — driven by server-injected config (window.__LOGLENS_CONFIG__).
  // Both elements start hidden in HTML; reveal them only when auth is enabled.
  const loglensConfig = window.__LOGLENS_CONFIG__ || { authEnabled: false, username: null };

  if (loglensConfig.authEnabled) {
    if (els.username) {
      els.username.textContent = loglensConfig.username || 'Authenticated user';
      els.username.classList.remove('hidden');
    }
    if (els.logout) {
      els.logout.classList.remove('hidden');
      els.logout.addEventListener('click', async () => {
        await fetch('./auth/logout', { method: 'POST' });
        window.location.href = './login';
      });
    }
  }

  initDatePickers();
  syncDraftInputsFromState();
  fetchLogs();
})();
