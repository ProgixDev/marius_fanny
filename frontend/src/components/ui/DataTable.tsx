"use client";

import React, { useState, Fragment, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Search,
  Filter,
  Columns,
  ArrowUp,
  ArrowDown,
  ChevronRight,
} from "lucide-react";
import { LucideIcon } from "lucide-react";

export interface ColumnDef<T> {
  key: string;
  label: string;
  icon?: LucideIcon;
  render?: (item: T) => React.ReactNode;
  defaultVisible?: boolean;
  sortable?: boolean;
  sortValue?: (item: T) => unknown;
}

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  filters?: FilterDef[];
  searchKey?: keyof T;
  searchKeys?: (keyof T)[];
  getSearchValue?: (item: T) => string;
  searchPlaceholder?: string;
  itemsPerPage?: number;
  actions?: (item: T) => React.ReactNode;
  rowClassName?: (item: T) => string;
  selectable?: boolean;
  onSelectionChange?: (selectedItems: T[]) => void;
  getRowId?: (item: T) => string;
  onRowClick?: (item: T) => void;
  expandableContent?: (item: T) => React.ReactNode;
  groupBy?: string;
  groupByLabel?: (value: unknown) => string;
  groupByOptions?: { value: string; label: string }[];
  onGroupByChange?: (value: string | undefined) => void;
}

export function DataTable<T extends object>({
  data,
  columns,
  filters = [],
  searchKey,
  searchKeys,
  getSearchValue,
  searchPlaceholder = "Search...",
  itemsPerPage = 10,
  actions,
  rowClassName,
  selectable = false,
  onSelectionChange,
  getRowId,
  onRowClick,
  expandableContent,
  groupBy,
  groupByLabel,
  groupByOptions,
  onGroupByChange,
}: DataTableProps<T>) {
  // Saisie affichée immédiatement, filtrage différé : sans cet anti-rebond,
  // chaque frappe reparcourait toutes les lignes (2 regex par ligne) puis
  // recopiait et retriait le tableau entier — d'où la sensation de blocage.
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchInput), 200);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const [filterValues, setFilterValues] = useState<Record<string, string>>(
    filters.reduce((acc, filter) => ({ ...acc, [filter.key]: "all" }), {}),
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(
    columns.reduce(
      (acc, col) => ({
        ...acc,
        [col.key]: col.defaultVisible !== false,
      }),
      {},
    ),
  );

  useEffect(() => {
    setVisibleColumns((prev) => {
      const next: Record<string, boolean> = {};
      for (const col of columns) {
        next[col.key] = prev[col.key] ?? col.defaultVisible !== false;
      }
      return next;
    });
  }, [columns]);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const filteredData = useMemo(() => data.filter((item) => {
    // Search filter
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();

      if (getSearchValue) {
        const searchValue = getSearchValue(item).toLowerCase();
        if (!searchValue.includes(lowerSearchTerm)) {
          return false;
        }
      } else if (searchKeys && searchKeys.length > 0) {
        const matches = searchKeys.some((key) => {
          const value = String(
            (item as Record<string, unknown>)[key as string] ?? "",
          ).toLowerCase();
          return value.includes(lowerSearchTerm);
        });
        if (!matches) {
          return false;
        }
      } else if (searchKey) {
        const searchValue = String(
          (item as Record<string, unknown>)[searchKey as string],
        ).toLowerCase();
        if (!searchValue.includes(lowerSearchTerm)) {
          return false;
        }
      }
    }

    // Custom filters
    for (const filter of filters) {
      const filterValue = filterValues[filter.key];
      if (filterValue && filterValue !== "all") {
        const rawValue = (item as Record<string, unknown>)[filter.key];
        if (Array.isArray(rawValue)) {
          if (!rawValue.map(String).includes(filterValue)) return false;
        } else if (String(rawValue) !== filterValue) {
          return false;
        }
      }
    }

    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, searchTerm, filterValues, getSearchValue, searchKeys, searchKey]);

  // Sans tri actif, on garde le tableau tel quel : la copie puis le tri
  // s'exécutaient à chaque rendu même quand il n'y avait rien à trier.
  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;
    const col = columns.find((c) => c.key === sortKey);
    if (!col || col.sortable === false) return filteredData;
    const getSortValue = (item: T) => {
      if (col.sortValue) return col.sortValue(item);
      return item[col.key as keyof T];
    };
    return [...filteredData].sort((a, b) => {
      const aStr = String(getSortValue(a)).toLowerCase();
      const bStr = String(getSortValue(b)).toLowerCase();
      if (aStr < bStr) return sortDirection === "asc" ? -1 : 1;
      if (aStr > bStr) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortKey, sortDirection, columns]);

  // Group data if groupBy is provided
  const groupedData = groupBy
    ? sortedData.reduce(
        (acc, item) => {
          const groupKey = String(
            (item as Record<string, unknown>)[groupBy] ?? "",
          );
          if (!acc[groupKey]) {
            acc[groupKey] = [];
          }
          acc[groupKey].push(item);
          return acc;
        },
        {} as Record<string, T[]>,
      )
    : null;

  const totalPages = Math.ceil(sortedData.length / itemsPerPage);
  const paginatedData = groupedData
    ? sortedData
    : sortedData.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage,
      );

  const visibleColumnDefs = columns.filter((col) => visibleColumns[col.key]);

  const getItemId = (item: T, index: number): string => {
    if (getRowId) return getRowId(item);
    if ("id" in item && typeof item.id === "string") return item.id;
    return String(index);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(
        paginatedData.map((item, index) => getItemId(item, index)),
      );
      setSelectedRows(allIds);
      if (onSelectionChange) {
        onSelectionChange(paginatedData);
      }
    } else {
      setSelectedRows(new Set());
      if (onSelectionChange) {
        onSelectionChange([]);
      }
    }
  };

  const handleSelectRow = (item: T, index: number, checked: boolean) => {
    const itemId = getItemId(item, index);
    const newSelectedRows = new Set(selectedRows);

    if (checked) {
      newSelectedRows.add(itemId);
    } else {
      newSelectedRows.delete(itemId);
    }

    setSelectedRows(newSelectedRows);

    if (onSelectionChange) {
      const selectedItems = paginatedData.filter((item, idx) =>
        newSelectedRows.has(getItemId(item, idx)),
      );
      onSelectionChange(selectedItems);
    }
  };

  const handleSelectGroup = (groupItems: T[], checked: boolean) => {
    const newSelectedRows = new Set(selectedRows);

    groupItems.forEach((item, index) => {
      const itemId = getItemId(item, index);
      if (checked) {
        newSelectedRows.add(itemId);
      } else {
        newSelectedRows.delete(itemId);
      }
    });

    setSelectedRows(newSelectedRows);

    if (onSelectionChange) {
      const allData = groupedData
        ? Object.values(groupedData).flat()
        : paginatedData;
      const selectedItems = allData.filter((item, idx) =>
        newSelectedRows.has(getItemId(item, idx)),
      );
      onSelectionChange(selectedItems);
    }
  };

  const isGroupFullySelected = (groupItems: T[]): boolean => {
    return groupItems.every((item, index) =>
      selectedRows.has(getItemId(item, index)),
    );
  };

  const isGroupPartiallySelected = (groupItems: T[]): boolean => {
    const selectedCount = groupItems.filter((item, index) =>
      selectedRows.has(getItemId(item, index)),
    ).length;
    return selectedCount > 0 && selectedCount < groupItems.length;
  };

  const isAllSelected =
    paginatedData.length > 0 &&
    paginatedData.every((item, index) =>
      selectedRows.has(getItemId(item, index)),
    );

  const toggleRowExpansion = (itemId: string) => {
    const newExpandedRows = new Set(expandedRows);
    if (newExpandedRows.has(itemId)) {
      newExpandedRows.delete(itemId);
    } else {
      newExpandedRows.add(itemId);
    }
    setExpandedRows(newExpandedRows);
  };

  const totalColumns =
    visibleColumnDefs.length +
    (actions ? 1 : 0) +
    (selectable ? 1 : 0) +
    (expandableContent ? 1 : 0);

  return (
    <div className="space-y-4 w-full max-w-full overflow-x-hidden">
      {/* Filters */}
      <div className="flex items-center space-x-2 flex-wrap gap-y-2">
        {(searchKey || searchKeys || getSearchValue) && (
          <div className="relative flex-1 max-w-sm">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              size={20}
            />
            <input
              type="text"
              placeholder={searchPlaceholder}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
        )}
        {showFilters && (
          <>
            {filters.map((filter) => (
              <select
                key={filter.key}
                value={filterValues[filter.key]}
                onChange={(e) => {
                  setFilterValues((prev) => ({
                    ...prev,
                    [filter.key]: e.target.value,
                  }));
                  setCurrentPage(1);
                }}
                className="px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
              >
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ))}
          </>
        )}
        {filters.length > 0 && (
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2.5 rounded-lg border transition-colors ${
              showFilters
                ? "bg-[#2D2A26] text-white border-[#2D2A26]"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            <Filter className="h-4 w-4" />
          </button>
        )}
        {columns.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-2.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors">
                <Columns className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="space-y-1">
              <DropdownMenuLabel>Colonnes</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((col) => (
                <DropdownMenuItem
                  key={col.key}
                  className="p-0"
                  onSelect={(e) => {
                    e.preventDefault();
                  }}
                >
                  <Label className="hover:bg-primary/30 flex items-center gap-2 rounded-md border p-2 has-aria-checked:bg-accent/5 w-full cursor-pointer">
                    <Checkbox
                      checked={visibleColumns[col.key]}
                      onCheckedChange={(checked) =>
                        setVisibleColumns((prev) => ({
                          ...prev,
                          [col.key]: !!checked,
                        }))
                      }
                      className="data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-primary-foreground mt-0.5"
                    />
                    <div className="grid gap-1 font-normal">
                      <p className="text-xs leading-none font-medium flex items-center gap-2">
                        {col.icon && <col.icon className="h-3.5 w-3.5" />}
                        {col.label}
                      </p>
                    </div>
                  </Label>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {groupByOptions && groupByOptions.length > 0 && (
          <Select
            value={groupBy || "none"}
            onValueChange={(value) =>
              onGroupByChange?.(value === "none" ? undefined : value)
            }
          >
            <SelectTrigger className="w-45">
              Grouper par
              <SelectValue placeholder="Grouper par" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Aucun groupement</SelectItem>
              {groupByOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {expandableContent && <th className="w-12 p-4"></th>}
                {selectable && (
                  <th className="w-12 p-4">
                    <Checkbox
                      checked={isAllSelected}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all"
                      className="data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-primary-foreground"
                    />
                  </th>
                )}
                {visibleColumnDefs.map((col) => (
                  <th
                    key={col.key}
                    className={`text-left p-4 text-sm font-semibold text-gray-600 ${
                      col.sortable !== false ? "cursor-pointer select-none" : ""
                    }`}
                    onClick={() => {
                      if (col.sortable === false) return;
                      if (sortKey === col.key) {
                        setSortDirection(
                          sortDirection === "asc" ? "desc" : "asc",
                        );
                      } else {
                        setSortKey(col.key);
                        setSortDirection("asc");
                      }
                      setCurrentPage(1);
                    }}
                  >
                    {col.icon && <col.icon className="mr-2 h-4 w-4 inline" />}
                    {col.label}
                    {sortKey === col.key &&
                      col.sortable !== false &&
                      (sortDirection === "asc" ? (
                        <ArrowUp className="ml-1 h-4 w-4 inline" />
                      ) : (
                        <ArrowDown className="ml-1 h-4 w-4 inline" />
                      ))}
                  </th>
                ))}
                {actions && (
                  <th className="text-right p-4 text-sm font-semibold text-gray-600">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {paginatedData.length === 0 ? (
                <tr>
                  <td
                    colSpan={totalColumns}
                    className="text-center py-8 text-gray-500"
                  >
                    Aucune donnée trouvée
                  </td>
                </tr>
              ) : groupedData ? (
                Object.entries(groupedData).map(([groupKey, groupItems]) => (
                  <Fragment key={`group-${groupKey}`}>
                    <tr className="bg-gray-50">
                      {expandableContent && <td className="w-12 p-4"></td>}
                      {selectable && (
                        <td className="w-12 p-4">
                          <Checkbox
                            checked={
                              isGroupFullySelected(groupItems)
                                ? true
                                : isGroupPartiallySelected(groupItems)
                                  ? "indeterminate"
                                  : false
                            }
                            onCheckedChange={(checked) =>
                              handleSelectGroup(groupItems, !!checked)
                            }
                            aria-label="Select group"
                            className="data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-primary-foreground"
                          />
                        </td>
                      )}
                      <td
                        colSpan={
                          totalColumns -
                          (expandableContent ? 1 : 0) -
                          (selectable ? 1 : 0)
                        }
                        className="font-semibold py-3 p-4 text-[#2D2A26]"
                      >
                        {groupByLabel ? groupByLabel(groupKey) : groupKey}
                      </td>
                    </tr>
                    {groupItems.map((item, index) => {
                      const itemId = getItemId(item, index);
                      const isSelected = selectedRows.has(itemId);
                      const isExpanded = expandedRows.has(itemId);

                      return (
                        <Fragment key={itemId}>
                          <tr
                            className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${rowClassName?.(item) || ""}`}
                            data-state={isSelected ? "selected" : undefined}
                            onClick={(e) => {
                              const target = e.target as HTMLElement;
                              if (
                                target.closest("button") ||
                                target.closest('[role="checkbox"]') ||
                                target.tagName === "INPUT"
                              ) {
                                return;
                              }
                              onRowClick?.(item);
                            }}
                            style={
                              onRowClick ? { cursor: "pointer" } : undefined
                            }
                          >
                            {expandableContent && (
                              <td
                                className="p-4"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => toggleRowExpansion(itemId)}
                                >
                                  <ChevronRight
                                    className={`h-4 w-4 transition-transform ${
                                      isExpanded ? "rotate-90" : ""
                                    }`}
                                  />
                                </Button>
                              </td>
                            )}
                            {selectable && (
                              <td
                                className="p-4"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) =>
                                    handleSelectRow(item, index, !!checked)
                                  }
                                  aria-label="Select row"
                                  className="data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-primary-foreground"
                                />
                              </td>
                            )}
                            {visibleColumnDefs.map((col) => (
                              <td key={col.key} className="p-4">
                                {col.render
                                  ? col.render(item)
                                  : String(
                                      (item as Record<string, unknown>)[
                                        col.key
                                      ],
                                    )}
                              </td>
                            ))}
                            {actions && (
                              <td
                                className="text-right p-4"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {actions(item)}
                              </td>
                            )}
                          </tr>
                          {expandableContent && isExpanded && (
                            <TableRow key={`${itemId}-expanded`}>
                              <TableCell
                                colSpan={totalColumns}
                                className="bg-muted/50 p-4"
                              >
                                {expandableContent(item)}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))
              ) : (
                paginatedData.map((item, index) => {
                  const itemId = getItemId(item, index);
                  const isSelected = selectedRows.has(itemId);
                  const isExpanded = expandedRows.has(itemId);

                  return (
                    <Fragment key={itemId}>
                      <tr
                        className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${rowClassName?.(item) || ""}`}
                        data-state={isSelected ? "selected" : undefined}
                        onClick={(e) => {
                          const target = e.target as HTMLElement;
                          if (
                            target.closest("button") ||
                            target.closest('[role="checkbox"]') ||
                            target.tagName === "INPUT"
                          ) {
                            return;
                          }
                          onRowClick?.(item);
                        }}
                        style={onRowClick ? { cursor: "pointer" } : undefined}
                      >
                        {expandableContent && (
                          <td
                            className="p-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => toggleRowExpansion(itemId)}
                            >
                              <ChevronRight
                                className={`h-4 w-4 transition-transform ${
                                  isExpanded ? "rotate-90" : ""
                                }`}
                              />
                            </Button>
                          </td>
                        )}
                        {selectable && (
                          <td
                            className="p-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) =>
                                handleSelectRow(item, index, !!checked)
                              }
                              aria-label="Select row"
                              className="data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-primary-foreground"
                            />
                          </td>
                        )}
                        {visibleColumnDefs.map((col) => (
                          <td key={col.key} className="p-4">
                            {col.render
                              ? col.render(item)
                              : String(
                                  (item as Record<string, unknown>)[col.key],
                                )}
                          </td>
                        ))}
                        {actions && (
                          <td
                            className="text-right p-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {actions(item)}
                          </td>
                        )}
                      </tr>
                      {isExpanded && expandableContent && (
                        <tr>
                          <td colSpan={totalColumns} className="p-4 bg-gray-50">
                            {expandableContent(item)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {!groupedData && totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-100 pt-4">
          <p className="text-sm text-gray-500">
            Page {currentPage} sur {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Précédent
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let page;
              if (totalPages <= 5) {
                page = i + 1;
              } else if (currentPage <= 3) {
                page = i + 1;
              } else if (currentPage >= totalPages - 2) {
                page = totalPages - 4 + i;
              } else {
                page = currentPage - 2 + i;
              }
              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                    currentPage === page
                      ? "bg-[#2D2A26] text-white"
                      : "border border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {page}
                </button>
              );
            })}
            <button
              onClick={() =>
                setCurrentPage(Math.min(totalPages, currentPage + 1))
              }
              disabled={currentPage === totalPages}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Suivant
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
