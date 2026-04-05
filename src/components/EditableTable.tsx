import { useState, useRef, useEffect } from 'react';

export interface ColumnDef<T> {
  field: keyof T & string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'boolean' | 'email' | 'textarea' | 'readonly';
  options?: { value: string; label: string; color?: string }[];
  editable?: boolean;
  sortable?: boolean;
  width?: string;
  render?: (value: any, row: T) => React.ReactNode;
}

export interface EditableTableProps<T extends { id: string | number }> {
  data: T[];
  columns: ColumnDef<T>[];
  apiBase: string;
  token: string;
  onDataChange: (data: T[]) => void;
  canAdd?: boolean;
  canDelete?: boolean;
  newRowDefaults?: Partial<T>;
  title?: string;
  emptyMessage?: string;
}

const API_URL = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';

export default function EditableTable<T extends { id: string | number }>({
  data,
  columns,
  apiBase,
  token,
  onDataChange,
  canAdd = false,
  canDelete = false,
  newRowDefaults = {},
  title,
  emptyMessage = 'Keine Einträge vorhanden.',
}: EditableTableProps<T>) {
  const [editingCell, setEditingCell] = useState<{ rowId: string | number; field: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [flashCell, setFlashCell] = useState<{ rowId: string | number; field: string } | null>(null);
  const [errorCell, setErrorCell] = useState<{ rowId: string | number; field: string } | null>(null);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingCell]);

  const apiCall = async (method: string, url: string, body?: any) => {
    const res = await fetch(`${API_URL}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  };

  const saveCell = async (rowId: string | number, field: string, value: any) => {
    try {
      await apiCall('PATCH', `${apiBase}/${rowId}`, { [field]: value });
      onDataChange(data.map(row => (row.id === rowId ? { ...row, [field]: value } : row)));
      setFlashCell({ rowId, field });
      setTimeout(() => setFlashCell(null), 800);
    } catch {
      setErrorCell({ rowId, field });
      setTimeout(() => setErrorCell(null), 2000);
    }
  };

  const addRow = async () => {
    try {
      const res = await apiCall('POST', apiBase, newRowDefaults || {});
      if (res.id !== undefined) {
        onDataChange([...data, { ...newRowDefaults, id: res.id } as T]);
      }
    } catch (e) {
      console.error('Failed to add row:', e);
    }
  };

  const deleteRow = async (rowId: string | number) => {
    if (!confirm('Wirklich löschen?')) return;
    try {
      await apiCall('DELETE', `${apiBase}/${rowId}`);
      onDataChange(data.filter(row => row.id !== rowId));
    } catch (e) {
      console.error('Failed to delete row:', e);
    }
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortedData = (() => {
    if (!sortField) return data;
    return [...data].sort((a, b) => {
      const aVal = (a as any)[sortField];
      const bVal = (b as any)[sortField];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  })();

  const isFlash = (rowId: string | number, field: string) =>
    flashCell?.rowId === rowId && flashCell?.field === field;

  const isError = (rowId: string | number, field: string) =>
    errorCell?.rowId === rowId && errorCell?.field === field;

  const isEditing = (rowId: string | number, field: string) =>
    editingCell?.rowId === rowId && editingCell?.field === field;

  const startEditing = (rowId: string | number, field: string, currentValue: any) => {
    setEditingCell({ rowId, field });
    setEditValue(currentValue != null ? String(currentValue) : '');
  };

  const commitEdit = (rowId: string | number, field: string, col: ColumnDef<T>) => {
    setEditingCell(null);
    let parsed: any = editValue;
    if (col.type === 'number') {
      parsed = editValue === '' ? null : Number(editValue);
    }
    const currentVal = (data.find(r => r.id === rowId) as any)?.[field];
    if (String(currentVal ?? '') !== String(parsed ?? '')) {
      saveCell(rowId, field, parsed);
    }
  };

  const cancelEdit = () => {
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, rowId: string | number, field: string, col: ColumnDef<T>) => {
    if (e.key === 'Enter' && col.type !== 'textarea') {
      commitEdit(rowId, field, col);
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  const cellClassName = (rowId: string | number, field: string) => {
    const classes = ['px-3 py-2 text-sm'];
    if (isFlash(rowId, field)) classes.push('bg-green-50 transition-colors duration-300');
    if (isError(rowId, field)) classes.push('ring-2 ring-red-400');
    return classes.join(' ');
  };

  const renderCell = (row: T, col: ColumnDef<T>) => {
    const value = (row as any)[col.field];
    const rowId = row.id;
    const editable = col.editable !== false && col.type !== 'readonly';

    // Select: always show as dropdown
    if (col.type === 'select' && editable && col.options) {
      const opt = col.options.find(o => o.value === value);
      return (
        <select
          value={value ?? ''}
          onChange={(e) => saveCell(rowId, col.field, e.target.value)}
          className="bg-transparent border-0 text-sm cursor-pointer focus:ring-1 focus:ring-garden-500 rounded"
        >
          {col.options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }

    // Boolean: always show as checkbox
    if (col.type === 'boolean' && editable) {
      return (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => saveCell(rowId, col.field, e.target.checked)}
          className="h-4 w-4 text-garden-600 rounded cursor-pointer"
        />
      );
    }

    // Readonly or non-editable
    if (!editable || col.type === 'readonly') {
      if (col.render) return col.render(value, row);
      if (col.type === 'select' && col.options) {
        const opt = col.options.find(o => o.value === value);
        if (opt?.color) {
          return (
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${opt.color}`}>
              {opt.label}
            </span>
          );
        }
        return <span>{opt?.label ?? value}</span>;
      }
      return <span className="text-gray-700">{value != null ? String(value) : ''}</span>;
    }

    // Editing mode
    if (isEditing(rowId, col.field)) {
      if (col.type === 'textarea') {
        return (
          <textarea
            ref={inputRef as React.Ref<HTMLTextAreaElement>}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => commitEdit(rowId, col.field, col)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancelEdit();
            }}
            rows={3}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-garden-500 focus:border-garden-500"
          />
        );
      }

      return (
        <input
          ref={inputRef as React.Ref<HTMLInputElement>}
          type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : col.type === 'email' ? 'email' : 'text'}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => commitEdit(rowId, col.field, col)}
          onKeyDown={(e) => handleKeyDown(e, rowId, col.field, col)}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-garden-500 focus:border-garden-500"
        />
      );
    }

    // Display mode (clickable)
    if (col.render) {
      return (
        <div
          className="cursor-pointer hover:bg-gray-100 rounded px-1 -mx-1"
          onClick={() => startEditing(rowId, col.field, value)}
        >
          {col.render(value, row)}
        </div>
      );
    }

    const displayValue = value != null ? String(value) : '';
    return (
      <div
        className="cursor-pointer hover:bg-gray-100 rounded px-1 -mx-1 min-h-[1.5rem]"
        onClick={() => startEditing(rowId, col.field, value)}
      >
        <span className="text-gray-700">{displayValue || <span className="text-gray-300">--</span>}</span>
      </div>
    );
  };

  return (
    <div>
      {(title || canAdd) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h3 className="text-lg font-semibold text-gray-800">{title}</h3>}
          {canAdd && (
            <button
              onClick={addRow}
              className="bg-garden-600 hover:bg-garden-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              + Neu
            </button>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {columns.map(col => {
                  const sortable = col.sortable !== false;
                  return (
                    <th
                      key={col.field}
                      className={`px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${col.width || ''} ${sortable ? 'cursor-pointer select-none hover:text-gray-700' : ''}`}
                      onClick={sortable ? () => handleSort(col.field) : undefined}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        {sortable && sortField === col.field && (
                          <span className="text-garden-600">{sortOrder === 'asc' ? '\u25B2' : '\u25BC'}</span>
                        )}
                      </span>
                    </th>
                  );
                })}
                {canDelete && <th className="px-3 py-3 w-10"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedData.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + (canDelete ? 1 : 0)} className="px-3 py-8 text-center text-gray-400 text-sm">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                sortedData.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    {columns.map(col => (
                      <td key={`${row.id}-${col.field}`} className={cellClassName(row.id, col.field)}>
                        {renderCell(row, col)}
                      </td>
                    ))}
                    {canDelete && (
                      <td className="px-3 py-2">
                        <button
                          onClick={() => deleteRow(row.id)}
                          className="text-red-400 hover:text-red-600 transition-colors"
                          title="Löschen"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
