// Remaining Stone Modal Component
// Remaining stone partition creation with CAD designer integration

import React from 'react';
import { FaTimes, FaPlus, FaTrash, FaRuler } from 'react-icons/fa';
import type { ContractWizardData, RemainingStone, StonePartition } from '../../types/contract.types';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { StoneCADDesigner } from '@/components/stone-cad/StoneCADDesigner';
import { formatDisplayNumber } from '@/lib/numberFormat';

interface RemainingStoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  remainingStone: RemainingStone | null;
  onCreatePartitions: () => void;
  wizardData: ContractWizardData;
  // Partition state
  partitions: StonePartition[];
  setPartitions: React.Dispatch<React.SetStateAction<StonePartition[]>>;
  // Units
  partitionWidthUnit: 'cm' | 'm';
  setPartitionWidthUnit: React.Dispatch<React.SetStateAction<'cm' | 'm'>>;
  partitionLengthUnit: 'cm' | 'm';
  setPartitionLengthUnit: React.Dispatch<React.SetStateAction<'cm' | 'm'>>;
  // CAD designer
  showRemainingStoneCAD: boolean;
  setShowRemainingStoneCAD: React.Dispatch<React.SetStateAction<boolean>>;
  // Handlers
  handleAddPartition: () => void;
  handleUpdatePartition: (partitionId: string, field: 'width' | 'length' | 'quantity', value: number) => void;
  handleRemovePartition: (partitionId: string) => void;
  // Validation
  partitionValidationErrors: Map<string, string>;
  // Errors
  errors: Record<string, string>;
  // Mandatory pricing
  remainingStoneIsMandatory: boolean;
  setRemainingStoneIsMandatory: React.Dispatch<React.SetStateAction<boolean>>;
  remainingStoneMandatoryPercentage: number;
  setRemainingStoneMandatoryPercentage: React.Dispatch<React.SetStateAction<number>>;
}

export const RemainingStoneModal: React.FC<RemainingStoneModalProps> = ({
  isOpen,
  onClose,
  remainingStone,
  onCreatePartitions,
  wizardData,
  partitions,
  setPartitions,
  partitionWidthUnit,
  setPartitionWidthUnit,
  partitionLengthUnit,
  setPartitionLengthUnit,
  showRemainingStoneCAD,
  setShowRemainingStoneCAD,
  handleAddPartition,
  handleUpdatePartition,
  handleRemovePartition,
  partitionValidationErrors,
  errors,
  remainingStoneIsMandatory,
  setRemainingStoneIsMandatory,
  remainingStoneMandatoryPercentage,
  setRemainingStoneMandatoryPercentage
}) => {
  if (!isOpen || !remainingStone) return null;

  // Modal content extracted from page.tsx lines 13627-14014
  // Content is in remaining_stone_modal_fixed.txt - needs to be inserted here
  return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
            <div className="flex max-h-[96vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-h-[90vh] sm:rounded-xl">
              <div className="border-b border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-700 dark:bg-gray-800/95 sm:p-6">
                <div className="flex justify-between items-center">
                  <h3 className="text-xl font-semibold text-gray-800 dark:text-white">
                    ایجاد محصول از سنگ باقی‌مانده
                  </h3>
                  <button
                    onClick={() => {
                      onClose();
                      
                      
                      setPartitions([{
                        id: `partition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        width: 0,
                        length: 0,
                        quantity: 1,
                        squareMeters: 0
                      }]);
                      
                      
                      
                      
                      
                      
                    }}
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    <FaTimes className="w-6 h-6" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 pb-28 sm:p-6 sm:pb-6">

                {/* Error Display */}
                {errors.products && (
                  <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-red-600 dark:text-red-400 text-sm">{errors.products}</p>
                  </div>
                )}

                {/* Remaining Stone Info */}
                <div className="mb-6 rounded-lg border border-teal-200 bg-teal-50 p-4 dark:border-teal-800 dark:bg-teal-900/20">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-teal-800 dark:text-teal-200">
                      سنگ باقی‌مانده
                    </h4>
                    <span className="px-2 py-1 bg-teal-100 dark:bg-teal-900/30 text-teal-800 dark:text-teal-200 text-xs rounded-full">
                      عرض: {formatDisplayNumber(remainingStone.width)}cm
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-lg bg-white/70 p-3 dark:bg-slate-900/40">
                      <span className="block text-xs text-teal-600 dark:text-teal-400">عرض باقی‌مانده</span>
                      <span className="font-medium text-teal-800 dark:text-teal-200">{formatDisplayNumber(remainingStone.width)}cm</span>
                    </div>
                    <div className="rounded-lg bg-white/70 p-3 dark:bg-slate-900/40">
                      <span className="block text-xs text-teal-600 dark:text-teal-400">طول باقی‌مانده</span>
                      <span className="font-medium text-teal-800 dark:text-teal-200">{formatDisplayNumber(remainingStone.length)}m</span>
                    </div>
                    <div className="rounded-lg bg-white/70 p-3 dark:bg-slate-900/40">
                      <span className="block text-xs text-teal-600 dark:text-teal-400">متر مربع</span>
                      <span className="font-medium text-teal-800 dark:text-teal-200">{formatDisplayNumber(remainingStone.squareMeters)}</span>
                    </div>
                  </div>
                </div>

                {/* Partitions Table */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-lg font-semibold text-gray-800 dark:text-white">
                      پارتیشن‌ها
                    </h4>
                    <button
                      onClick={handleAddPartition}
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-600"
                    >
                      <FaPlus className="w-4 h-4" />
                      افزودن ردیف
                    </button>
                  </div>

                  {/* Unit Selectors */}
                  <div className="mb-4 flex gap-4">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        واحد عرض
                      </label>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setPartitionWidthUnit('cm')}
                          className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                            partitionWidthUnit === 'cm'
                              ? 'bg-teal-500 text-white shadow-lg'
                              : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                          }`}
                        >
                          سانتی‌متر (cm)
                        </button>
                        <button
                          type="button"
                          onClick={() => setPartitionWidthUnit('m')}
                          className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                            partitionWidthUnit === 'm'
                              ? 'bg-teal-500 text-white shadow-lg'
                              : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                          }`}
                        >
                          متر (m)
                        </button>
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        واحد طول
                      </label>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => setPartitionLengthUnit('cm')}
                          className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                            partitionLengthUnit === 'cm'
                              ? 'bg-teal-500 text-white shadow-lg'
                              : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                          }`}
                        >
                          سانتی‌متر (cm)
                        </button>
                        <button
                          type="button"
                          onClick={() => setPartitionLengthUnit('m')}
                          className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                            partitionLengthUnit === 'm'
                              ? 'bg-teal-500 text-white shadow-lg'
                              : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                          }`}
                        >
                          متر (m)
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Partitions Table */}
                  <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                    <table className="w-full min-w-[680px]">
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">
                            عرض ({partitionWidthUnit === 'm' ? 'm' : 'cm'})
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">
                            طول ({partitionLengthUnit === 'm' ? 'm' : 'cm'})
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">
                            متر مربع (محاسبه شده)
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">
                            تعداد
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600 w-20">
                            عملیات
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {partitions.map((partition, index) => {
                          const widthInCm = partitionWidthUnit === 'm' ? partition.width * 100 : partition.width;
                          const lengthInCm = partitionLengthUnit === 'm' ? partition.length * 100 : partition.length;
                          const isValidWidth = widthInCm <= remainingStone.width && widthInCm > 0;
                          const isValidLength = lengthInCm <= (remainingStone.length * 100) && lengthInCm > 0;
                          
                          // Get validation error for this partition (from state or partition.validationError)
                          const partitionError = partition.validationError || partitionValidationErrors.get(partition.id);
                          const hasError = !!partitionError || (!isValidWidth && partition.width > 0) || (!isValidLength && partition.length > 0);

                          return (
                            <tr 
                              key={partition.id} 
                              className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                                hasError ? 'bg-red-50/50 dark:bg-red-900/10' : ''
                              }`}
                            >
                              <td className="px-4 py-3">
                                <FormattedNumberInput
                                  value={partition.width}
                                  onChange={(value) => handleUpdatePartition(partition.id, 'width', value)}
                                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm ${
                                    hasError
                                      ? 'border-red-500 dark:border-red-400'
                                      : 'border-gray-300 dark:border-gray-600'
                                  }`}
                                  min={0}
                                  step={0.1}
                                  placeholder="0"
                                />
                                {!isValidWidth && partition.width > 0 && (
                                  <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                                    حداکثر: {formatDisplayNumber(remainingStone.width)}cm
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <FormattedNumberInput
                                  value={partition.length}
                                  onChange={(value) => handleUpdatePartition(partition.id, 'length', value)}
                                  className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm ${
                                    hasError
                                      ? 'border-red-500 dark:border-red-400'
                                      : 'border-gray-300 dark:border-gray-600'
                                  }`}
                                  min={0}
                                  step={0.1}
                                  placeholder="0"
                                />
                                {!isValidLength && partition.length > 0 && (
                                  <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                                    حداکثر: {formatDisplayNumber(remainingStone.length * 100)}cm
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                                  {formatDisplayNumber(partition.squareMeters)}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <FormattedNumberInput
                                  value={partition.quantity ?? 1}
                                  onChange={(value) => handleUpdatePartition(partition.id, 'quantity', value)}
                                  className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                                  min={1}
                                  step={1}
                                  placeholder="1"
                                />
                              </td>
                              <td className="px-4 py-3 text-center">
                                <button
                                  onClick={() => handleRemovePartition(partition.id)}
                                  disabled={partitions.length === 1}
                                  className="p-2 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  title="حذف"
                                >
                                  <FaTrash className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        {/* Display partition-specific validation errors below the table */}
                        {partitions.some(p => p.validationError || partitionValidationErrors.has(p.id)) && (
                          <tr>
                            <td colSpan={5} className="px-4 py-3">
                              <div className="space-y-2">
                                {partitions.map(partition => {
                                  const error = partition.validationError || partitionValidationErrors.get(partition.id);
                                  if (!error) return null;
                                  
                                  return (
                                    <div 
                                      key={`error-${partition.id}`}
                                      className="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
                                    >
                                      <span className="text-red-600 dark:text-red-400 font-medium text-xs">⚠️</span>
                                      <div className="flex-1">
                                        <p className="text-xs text-red-700 dark:text-red-300 font-medium">
                                          پارتیشن #{partitions.findIndex(p => p.id === partition.id) + 1}:
                                        </p>
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                          {error}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary */}
                  {(() => {
                    const validPartitions = partitions.filter(p => p.width > 0 && p.length > 0);
                    const totalUsedSquareMeters = validPartitions.reduce((sum, p) => sum + p.squareMeters, 0);
                    const remainingSquareMeters = remainingStone.squareMeters - totalUsedSquareMeters;
                    const totalPieces = validPartitions.reduce((sum, p) => sum + Math.max(1, Math.floor(p.quantity || 1)), 0);

                    return validPartitions.length > 0 && (
                      <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="grid grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-blue-600 dark:text-blue-400">مجموع متر مربع استفاده شده:</span>
                            <span className="font-medium text-blue-800 dark:text-blue-200 mr-2">{formatDisplayNumber(totalUsedSquareMeters)}</span>
                          </div>
                          <div>
                            <span className="text-blue-600 dark:text-blue-400">متر مربع باقی‌مانده:</span>
                            <span className={`font-medium mr-2 ${remainingSquareMeters >= 0 ? 'text-blue-800 dark:text-blue-200' : 'text-red-600 dark:text-red-400'}`}>
                              {formatDisplayNumber(remainingSquareMeters)}
                            </span>
                          </div>
                          <div>
                            <span className="text-blue-600 dark:text-blue-400">تعداد پارتیشن‌ها:</span>
                            <span className="font-medium text-blue-800 dark:text-blue-200 mr-2">{validPartitions.length}</span>
                          </div>
                          <div>
                            <span className="text-blue-600 dark:text-blue-400">تعداد کل قطعات:</span>
                            <span className="font-medium text-blue-800 dark:text-blue-200 mr-2">{totalPieces}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* CAD Designer for Remaining Stone */}
                <div className="mt-6 overflow-hidden rounded-xl border border-teal-200 bg-white shadow-lg dark:border-teal-800 dark:bg-gray-800">
                  <div className="bg-gradient-to-r from-teal-500 to-teal-600 px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                          <FaRuler className="text-white text-lg" />
                        </div>
                        <div>
                          <h4 className="text-lg font-bold text-white">ابزار طراحی CAD</h4>
                          <p className="text-xs text-teal-100">طراحی پارتیشن‌ها روی سنگ باقی‌مانده</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowRemainingStoneCAD(!showRemainingStoneCAD)}
                        className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors text-sm font-medium"
                      >
                        {showRemainingStoneCAD ? 'مخفی کردن' : 'نمایش'}
                      </button>
                    </div>
                  </div>
                  
                  {showRemainingStoneCAD && remainingStone && (
                    <div className="p-6">
                      <p className="text-sm text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                        از این ابزار برای طراحی و برنامه‌ریزی پارتیشن‌ها روی سنگ باقی‌مانده استفاده کنید. می‌توانید پارتیشن‌ها را به صورت بصری رسم کنید.
                      </p>
                      
                      <StoneCADDesigner
                        originalLength={remainingStone.length}
                        originalWidth={remainingStone.width}
                        lengthUnit="m"
                        widthUnit="cm"
                        productType="longitudinal"
                        mode="design"
                        enableCostCalculation={false}
                        enableAutoSync={true}
                        onDimensionsCalculated={(dims) => {
                          // When dimensions are drawn in CAD, update partitions
                          if (dims.length && dims.width && partitions.length > 0) {
                            const firstPartition = partitions[0];
                            handleUpdatePartition(firstPartition.id, 'width', dims.width);
                            handleUpdatePartition(firstPartition.id, 'length', dims.length);
                          }
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="sticky bottom-0 -mx-4 mt-6 flex justify-end gap-3 border-t border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-700 dark:bg-gray-800/95 sm:-mx-6 sm:px-6">
                  <button
                    onClick={() => {
                      onClose();
                      
                      
                      setPartitions([{
                        id: `partition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        width: 0,
                        length: 0,
                        quantity: 1,
                        squareMeters: 0
                      }]);
                      
                      
                      
                      
                      
                      
                    }}
                    className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                  >
                    انصراف
                  </button>
                  <button
                    onClick={() => {
                      console.log('🔘 Partition Button clicked!');
                      onCreatePartitions();
                    }}
                    className="min-h-11 rounded-lg bg-gradient-to-r from-teal-500 to-teal-600 px-6 py-2 font-medium text-white transition-all duration-200 hover:from-teal-600 hover:to-teal-700"
                  >
                    ایجاد پارتیشن‌ها
                  </button>
                </div>
              </div>
            </div>
          </div>
  );
};
