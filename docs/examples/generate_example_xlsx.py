#!/usr/bin/env python3
"""
Generate example XLSX file for Creator Analysis format upload
"""
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from datetime import datetime

# Create workbook
wb = openpyxl.Workbook()
wb.remove(wb.active)

# Sheet 1: Filter
ws_filter = wb.create_sheet("Filter", 0)
ws_filter['A1'] = "Start Date"
ws_filter['B1'] = "20240715"
ws_filter['A2'] = "End Date"
ws_filter['B2'] = "20240721"
ws_filter['A3'] = "Creator Level Filter"
ws_filter['B3'] = ""

# Sheet 2: Data
ws_data = wb.create_sheet("Data", 1)

# Headers
headers = [
    "Creator name",
    "Creator ID",
    "Binding status",
    "Creator city",
    "Creator level",
    "Sales value",
    "Orders",
    "AOV",
    "Redemption amount",
    "Redeemed orders",
    "New posts",
    "Posts with sales",
    "Live streams",
    "Valid live streams"
]

# Style for headers
header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
header_font = Font(bold=True, color="FFFFFF")
border = Border(
    left=Side(style='thin'),
    right=Side(style='thin'),
    top=Side(style='thin'),
    bottom=Side(style='thin')
)

# Add headers
for col_num, header in enumerate(headers, 1):
    cell = ws_data.cell(row=1, column=col_num)
    cell.value = header
    cell.fill = header_fill
    cell.font = header_font
    cell.alignment = Alignment(horizontal="center", vertical="center")
    cell.border = border

# Sample data
data = [
    ["Siti Saleha", "@sitisaleha_beauty", "Bound creators", "Jakarta", "Creator Level 2", 15500000, 324, 47840, 2400000, 45, 12, 8, 6, 5],
    ["Budi Fashion", "@budifashion", "Bound creators", "Surabaya", "Creator Level 1", 8750000, 182, 48076, 1200000, 28, 15, 10, 4, 3],
    ["Rina Cook", "@rinacooking", "Previously bound", "Bandung", "Creator Level 3", 22300000, 465, 47957, 3600000, 52, 18, 14, 8, 7],
    ["Dina Beauty", "@dinabeauty", "Bound creators", "Jakarta", "Creator Level 2", 12800000, 267, 47928, 1920000, 38, 11, 7, 5, 4],
    ["Agus Tech", "@agustech", "Bound creators", "Yogyakarta", "Creator Level 1", 6500000, 135, 48148, 975000, 20, 10, 6, 3, 2],
]

# Add data rows
for row_num, row_data in enumerate(data, 2):
    for col_num, value in enumerate(row_data, 1):
        cell = ws_data.cell(row=row_num, column=col_num)
        cell.value = value
        cell.border = border
        cell.alignment = Alignment(horizontal="left", vertical="center")

        # Right align numbers
        if isinstance(value, (int, float)) and col_num > 5:
            cell.alignment = Alignment(horizontal="right", vertical="center")

# Adjust column widths
ws_data.column_dimensions['A'].width = 18
ws_data.column_dimensions['B'].width = 20
ws_data.column_dimensions['C'].width = 20
ws_data.column_dimensions['D'].width = 15
ws_data.column_dimensions['E'].width = 18
ws_data.column_dimensions['F'].width = 15
ws_data.column_dimensions['G'].width = 12
ws_data.column_dimensions['H'].width = 12
ws_data.column_dimensions['I'].width = 18
ws_data.column_dimensions['J'].width = 16
ws_data.column_dimensions['K'].width = 12
ws_data.column_dimensions['L'].width = 17
ws_data.column_dimensions['M'].width = 14
ws_data.column_dimensions['N'].width = 18

# Adjust Filter sheet
ws_filter.column_dimensions['A'].width = 25
ws_filter.column_dimensions['B'].width = 20

# Save
output_path = "creator-weekly-upload-example.xlsx"
wb.save(output_path)
print(f"✅ File created: {output_path}")
