/**
 * Home page: I²t transformer UI
 * 
 * Features:
 * - Paste/import CSV/TSV data
 * - Transform TC (I-t) to I²t curves
 * - Display TC and I²t charts
 * - Compute equivalent time at target current
 * - Support up to 10 series
 * - Toggle linear/log10 axes
 */

import React, { useState } from "react";
import type { Sample } from "../lib/i2t";
import type { AxisMode } from "../lib/coords";
import { parseCsvToSamples } from "../lib/parse";
import { integrateI2t } from "../lib/i2t";
import { buildI2tAndEquivalent } from "../features/transform/I2tTransform";
import { ChartCanvas, type Series } from "../components/ChartCanvas";

const EXAMPLE_DATA = `t,i
0.01,3000
0.10,1500
1.00,600
3.00,350`;

export default function Home() {
  const [inputText, setInputText] = useState("");
  const [seriesList, setSeriesList] = useState<Array<{ id: string; tc: Sample[]; color: string }>>([]);
  const [eqCurrent, setEqCurrent] = useState<number>(500);
  const [modeX, setModeX] = useState<AxisMode>("log10");
  const [modeY, setModeY] = useState<AxisMode>("log10");
  const [modeX_I2t, setModeX_I2t] = useState<AxisMode>("log10");
  const [modeY_I2t, setModeY_I2t] = useState<AxisMode>("linear");
  
  const loadExample = () => {
    setInputText(EXAMPLE_DATA);
  };
  
  const parseAndAdd = () => {
    if (!inputText.trim()) return;
    
    const samples = parseCsvToSamples(inputText);
    if (samples.length === 0) {
      alert("No valid data found. Please check format: t,i or time,current");
      return;
    }
    
    if (seriesList.length >= 10) {
      alert("Maximum 10 series allowed");
      return;
    }
    
    const id = `series-${Date.now()}`;
    const color = `hsl(${(seriesList.length * 137.5) % 360}, 70%, 50%)`;
    setSeriesList([...seriesList, { id, tc: samples, color }]);
    setInputText("");
  };
  
  const removeSeries = (id: string) => {
    setSeriesList(seriesList.filter(s => s.id !== id));
  };
  
  const clearAll = () => {
    setSeriesList([]);
  };
  
  // Build TC chart data
  const tcSeries: Series[] = seriesList.map(s => ({
    id: s.id,
    data: s.tc.map(p => ({ x: p.t, y: p.i })),
    color: s.color,
  }));
  
  // Build I²t chart data
  const i2tSeries: Series[] = seriesList.map(s => {
    const { i2t } = buildI2tAndEquivalent(s.tc, eqCurrent);
    return {
      id: s.id,
      data: i2t,
      color: s.color,
    };
  });
  
  // Compute totals and equivalent times
  const totals = seriesList.map(s => ({
    id: s.id,
    total: integrateI2t(s.tc),
    tEq: eqCurrent > 0 ? buildI2tAndEquivalent(s.tc, eqCurrent).tEq : null,
  }));
  
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">I²t Transformer</h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Input panel */}
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-xl font-semibold mb-4">Input Data</h2>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Paste CSV/TSV data (t,i or time,current)..."
              className="w-full h-32 p-3 border rounded font-mono text-sm"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={parseAndAdd}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Add Series ({seriesList.length}/10)
              </button>
              <button
                onClick={loadExample}
                className="px-4 py-2 border rounded hover:bg-gray-50"
              >
                Load Example
              </button>
              {seriesList.length > 0 && (
                <button
                  onClick={clearAll}
                  className="px-4 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>
          
          {/* Settings panel */}
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-xl font-semibold mb-4">Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Equivalent Current I_eq (A):
                </label>
                <input
                  type="number"
                  value={eqCurrent}
                  onChange={(e) => setEqCurrent(Number(e.target.value) || 0)}
                  className="w-full p-2 border rounded"
                  min="0"
                  step="0.1"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">TC Chart Axes:</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    X: <select
                      value={modeX}
                      onChange={(e) => setModeX(e.target.value as AxisMode)}
                      className="border rounded p-1"
                    >
                      <option value="linear">Linear</option>
                      <option value="log10">Log10</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    Y: <select
                      value={modeY}
                      onChange={(e) => setModeY(e.target.value as AxisMode)}
                      className="border rounded p-1"
                    >
                      <option value="linear">Linear</option>
                      <option value="log10">Log10</option>
                    </select>
                  </label>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">I²t Chart Axes:</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    X: <select
                      value={modeX_I2t}
                      onChange={(e) => setModeX_I2t(e.target.value as AxisMode)}
                      className="border rounded p-1"
                    >
                      <option value="linear">Linear</option>
                      <option value="log10">Log10</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    Y: <select
                      value={modeY_I2t}
                      onChange={(e) => setModeY_I2t(e.target.value as AxisMode)}
                      className="border rounded p-1"
                    >
                      <option value="linear">Linear</option>
                      <option value="log10">Log10</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <ChartCanvas
              series={tcSeries}
              modeX={modeX}
              modeY={modeY}
              title="TC Curve (I vs t)"
              width={800}
              height={600}
            />
          </div>
          
          <div className="bg-white rounded-lg shadow p-4">
            <ChartCanvas
              series={i2tSeries}
              modeX={modeX_I2t}
              modeY={modeY_I2t}
              title="I²t vs t"
              width={800}
              height={600}
            />
          </div>
        </div>
        
        {/* Readouts */}
        {seriesList.length > 0 && (
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-xl font-semibold mb-4">Results</h2>
            <div className="space-y-2">
              {seriesList.map((s, idx) => {
                const total = totals[idx];
                return (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-3 border rounded"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-4 h-4 rounded"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="font-medium">Series {idx + 1}</span>
                      <button
                        onClick={() => removeSeries(s.id)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="flex gap-6 text-sm">
                      <span>
                        Total I²t: <strong>{total.total.toExponential(3)}</strong> A²s
                      </span>
                      {total.tEq !== null && (
                        <span>
                          t* at {eqCurrent}A: <strong>{total.tEq.toFixed(4)}</strong> s
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

