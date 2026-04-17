import { Response } from "express";
import { PharmaRequest } from "../types/index.js";
import Product from "../Models/Product.js";
import Supplier from "../Models/Supplier.js";
import Batch from "../Models/Batch.js";
import mongoose from "mongoose";
import redisService from "../../config/redis.js";

export const getProducts = async (req: PharmaRequest, res: Response) => {
  try {
    const {
      search,
      status,
      supplier,
      lowStock,
      schedule,
      startDate,
      endDate,
      expiryStatus,
      page = 1,
      limit = 50,
    } = req.query;
    const pharmacyId = req.pharma?._id;

    if (!pharmacyId) {
      return res.json({
        success: true,
        count: 0,
        total: 0,
        totalPages: 0,
        currentPage: Number(page),
        data: [],
      });
    }

    let query: any = { isActive: true, pharmacy: pharmacyId };

    // Search Filter
    if (search) {
      const escapedSearch = (search as string).replace(
        /[/\-\\^$*+?.()|[\]{}]/g,
        "\\$&",
      );
      query.$or = [
        { name: { $regex: escapedSearch, $options: "i" } },
        { brand: { $regex: escapedSearch, $options: "i" } },
        { generic: { $regex: escapedSearch, $options: "i" } },
        { sku: { $regex: escapedSearch, $options: "i" } },
      ];
    }

    // Status Filter
    if (status === "In Stock") {
      query.$expr = { $gt: ["$stock", "$minStock"] };
      query.stock = { $gt: 0 };
    } else if (status === "Out of Stock") {
      query.stock = 0;
    } else if (status === "Low Stock" || lowStock === "true") {
      query.$expr = { $lte: ["$stock", "$minStock"] };
      query.stock = { $gt: 0 };
    }

    // Supplier Filter
    if (supplier && supplier !== "All Suppliers") {
      if (mongoose.Types.ObjectId.isValid(supplier as string)) {
        query.supplier = supplier;
      } else {
        // If it's a name, we might need to find the supplier ID first
        const foundSupplier = await Supplier.findOne({
          pharmacy: pharmacyId,
          name: { $regex: new RegExp("^" + supplier + "$", "i") },
        });
        if (foundSupplier) {
          query.supplier = foundSupplier._id;
        }
      }
    }

    // Expiry Status Filter
    const now = new Date();
    if (expiryStatus === "Expired") {
      query.expiryDate = { $lt: now };
    } else if (expiryStatus === "Expiring Soon (30 days)") {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      query.expiryDate = { $gte: now, $lte: thirtyDaysFromNow };
    } else if (expiryStatus === "Expiring in 3 months") {
      const threeMonthsFromNow = new Date();
      threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);
      query.expiryDate = { $gte: now, $lte: threeMonthsFromNow };
    }

    if (schedule) {
      query.schedule = schedule;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate as string);
      if (endDate) query.createdAt.$lte = new Date(endDate as string);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [products, total] = await Promise.all([
      Product.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("supplier", "name")
        .lean(),
      Product.countDocuments(query),
    ]);

    res.json({
      success: true,
      count: products.length,
      total,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      data: products,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const getProduct = async (req: PharmaRequest, res: Response) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      pharmacy: req.pharma?._id,
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({
      success: true,
      data: product,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const createProduct = async (req: PharmaRequest, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const pharmacyId = req.pharma?._id;
    const hospitalId = req.pharma?.hospital;

    const { batchNumber, expiryDate, stock, unitCost, supplier, ...rest } =
      req.body;

    let supplierId: any = undefined;
    if (supplier) {
      if (mongoose.Types.ObjectId.isValid(supplier)) {
        supplierId = supplier;
      } else {
        const foundSupplier = await Supplier.findOne({
          pharmacy: pharmacyId,
          name: { $regex: new RegExp("^" + supplier + "$", "i") },
        });
        if (foundSupplier) supplierId = foundSupplier._id;
      }
    }

    const productData = {
      brand: rest.brand || rest.brandName,
      generic: rest.generic || rest.genericName,
      sku: rest.sku,
      form: rest.form,
      strength: rest.strength,
      schedule: rest.schedule,
      gstPercent: rest.gstPercent || rest.gst || 12,
      hsnCode: rest.hsnCode,
      minStock: rest.minStock || rest.minStockLevel || 10,
      unitsPerPack: rest.unitsPerPack || 1,
      mrp: rest.mrp,
      batchNumber,
      expiryDate,
      stock: stock || 0,
      unitCost: unitCost || 0,
      supplier: supplierId,
      pharmacy: pharmacyId,
      hospital: hospitalId,
    };

    const product = await Product.create([productData], { session });

    // If initial stock and batch info provided, create initial batch
    if (stock > 0 && batchNumber && expiryDate) {
      await Batch.create(
        [
          {
            product: product[0]._id,
            batchNo: batchNumber,
            expiry: expiryDate,
            qtyReceived: stock,
            qtySold: 0,
            unitCost: unitCost || 0,
            supplier,
            pharmacy: pharmacyId,
            hospital: hospitalId,
          },
        ],
        { session },
      );
    }

    await session.commitTransaction();

    // 🚀 PERFORMANCE FIX: Invalidate dashboard stats cache
    await redisService.del(`pharma:dashboard:stats:${pharmacyId}`);

    res.status(201).json({
      success: true,
      data: product[0],
    });
  } catch (error: any) {
    await session.abortTransaction();
    res.status(500).json({ message: error.message });
  } finally {
    session.endSession();
  }
};

export const updateProduct = async (req: PharmaRequest, res: Response) => {
  try {
    const { supplier, ...rest } = req.body;
    const pharmacyId = req.pharma?._id;

    let updateData: any = { ...rest };

    if (supplier) {
      if (mongoose.Types.ObjectId.isValid(supplier)) {
        updateData.supplier = supplier;
      } else {
        const foundSupplier = await Supplier.findOne({
          pharmacy: pharmacyId,
          name: { $regex: new RegExp("^" + supplier + "$", "i") },
        });
        if (foundSupplier) updateData.supplier = foundSupplier._id;
      }
    }

    // Map aliases
    if (rest.brandName) updateData.brand = rest.brandName;
    if (rest.genericName) updateData.generic = rest.genericName;
    if (rest.currentStock !== undefined) updateData.stock = rest.currentStock;
    if (rest.minStockLevel !== undefined)
      updateData.minStock = rest.minStockLevel;
    if (rest.gst !== undefined) updateData.gstPercent = rest.gst;

    // Find existing to compute new name if brand/strength/form changes
    const existingProduct = await Product.findOne({
      _id: req.params.id,
      pharmacy: pharmacyId,
    });
    if (!existingProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    const newBrand = updateData.brand || existingProduct.brand;
    const newStrength = updateData.strength || existingProduct.strength;
    const newForm = updateData.form || existingProduct.form;
    updateData.name = `${newBrand} ${newStrength} ${newForm}`;

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, pharmacy: pharmacyId },
      updateData,
      { new: true, runValidators: true },
    );

    // 🚀 PERFORMANCE FIX: Invalidate dashboard stats cache
    await redisService.del(`pharma:dashboard:stats:${pharmacyId}`);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({
      success: true,
      data: product,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteProduct = async (req: PharmaRequest, res: Response) => {
  try {
    const product = await Product.findOneAndDelete({
      _id: req.params.id,
      pharmacy: req.pharma?._id,
    });

    if (product) {
      // 🚀 PERFORMANCE FIX: Invalidate dashboard stats cache
      await redisService.del(`pharma:dashboard:stats:${req.pharma?._id}`);
    }

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({
      success: true,
      message: "Product permanently deleted successfully",
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * Resolve expiry date for import: if the date is in the past or less than
 * 6 months from now, advance it by full years until it clears the threshold.
 * Returns undefined if no date is provided.
 */
const resolveExpiryDate = (raw: string | Date | undefined | null): Date | undefined => {
  if (!raw) return undefined;
  const parsed = new Date(raw as string);
  if (isNaN(parsed.getTime())) return undefined;

  const minFuture = new Date();
  minFuture.setMonth(minFuture.getMonth() + 6);

  if (parsed >= minFuture) return parsed;

  // Advance by full years until it clears the 6-month minimum
  const result = new Date(parsed);
  while (result < minFuture) {
    result.setFullYear(result.getFullYear() + 1);
  }
  return result;
};

export const bulkCreateProducts = async (req: PharmaRequest, res: Response) => {
  const productsData = req.body;
  if (!Array.isArray(productsData)) {
    return res.status(400).json({
      success: false,
      message: "Invalid data format. Expected an array of products.",
    });
  }

  const pharmacyId = req.pharma?._id;
  const hospitalId = req.pharma?.hospital;

  let addedCount = 0;
  let errorCount = 0;
  const errors: any[] = [];

  // Helper to normalize schedule
  const normalizeSchedule = (val: string): any => {
    if (!val) return "OTC";
    const v = val.toUpperCase();
    if (v.includes("H1")) return "H1";
    if (v.includes("X")) return "X";
    if (v.startsWith("H") || v.includes("PRESCRIPTION")) return "H";
    return "OTC";
  };

  // Helper to normalize form
  const normalizeForm = (val: string): any => {
    const validForms = [
      "TAB",
      "CAP",
      "SYR",
      "INJ",
      "CRM",
      "ONT",
      "DRP",
      "PWD",
      "SR TAB",
      "SR CAP",
      "TABLET",
      "CAPSULE",
      "SYRUP",
      "INJECTION",
      "CREAM",
      "DROPS",
      "SUSPENSION",
      "SUSP",
    ];
    if (!val) return "TABLET";
    const v = val.toUpperCase().trim();
    if (validForms.includes(v)) return v;
    // Check partial matches or variations
    if (v.includes("TAB")) return "TABLET";
    if (v.includes("CAP")) return "CAPSULE";
    if (v.includes("SYR")) return "SYRUP";
    if (v.includes("INJ")) return "INJECTION";
    return "TABLET";
  };

  for (const item of productsData) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const brand = item.brandName || item.brand;
      const generic = item.genericName || item.generic;
      const sku = item.sku;

      if (!brand || !generic || !sku) {
        throw new Error("SKU, Brand Name, and Generic Name are required");
      }

      let query = { sku, pharmacy: pharmacyId };
      let product = await Product.findOne(query).session(session);

      if (product) {
        const stockToAdd = Number(item.currentStock) || Number(item.stock) || 0;
        await Product.updateOne(
          { _id: product._id },
          { $inc: { stock: stockToAdd } },
        ).session(session);
      } else {
        let supplierId: any = undefined;
        if (item.supplier) {
          if (mongoose.Types.ObjectId.isValid(item.supplier)) {
            supplierId = item.supplier;
          } else {
            const foundSupplier = await Supplier.findOne({
              pharmacy: pharmacyId,
              name: {
                $regex: new RegExp("^" + item.supplier.trim() + "$", "i"),
              },
            }).session(session);
            if (foundSupplier) supplierId = foundSupplier._id;
          }
        }

        const productData = {
          brand: brand.trim(),
          generic: generic.trim(),
          sku: sku.trim(),
          strength: item.strength?.trim() || "N/A",
          form: normalizeForm(item.form),
          schedule: normalizeSchedule(item.schedule),
          mrp: Number(item.mrp) || 0,
          gstPercent: Number(item.gst) || Number(item.gstPercent) || 12,
          hsnCode: item.hsnCode?.trim() || undefined,
          batchNumber: item.batchNumber?.trim() || undefined,
          expiryDate: resolveExpiryDate(item.expiryDate),
          unitCost: Number(item.unitCost) || 0,
          minStock: Number(item.minStockLevel) || Number(item.minStock) || 10,
          stock: Number(item.currentStock) || Number(item.stock) || 0,
          unitsPerPack: Number(item.unitsPerPack) || 1,
          supplier: supplierId,
          pharmacy: pharmacyId,
          hospital: hospitalId,
          isActive: true,
        };

        const created = await Product.create([productData], { session });
        product = created[0];
      }

      const addedStock = Number(item.currentStock) || Number(item.stock) || 0;
      if (addedStock > 0) {
        // Ensure we have a default supplier if missing for the batch (Batch schema requires supplier)
        let batchSupplier = product.supplier;
        if (!batchSupplier) {
          const fallback = await Supplier.findOne({
            pharmacy: pharmacyId,
          }).session(session);
          batchSupplier = fallback?._id;
        }

        // Resolve expiry date — if past/expired, advance by full years to make it future
        let expiryDate = resolveExpiryDate(item.expiryDate);
        if (!expiryDate) {
          expiryDate = new Date();
          expiryDate.setFullYear(expiryDate.getFullYear() + 5);
        }

        if (batchSupplier) {
          await Batch.create(
            [
              {
                product: product._id,
                batchNo: item.batchNumber || "INITIAL",
                expiry: expiryDate,
                qtyReceived: addedStock,
                qtySold: 0,
                unitCost: Number(item.unitCost) || Number(item.mrp) * 0.7,
                supplier: batchSupplier,
                pharmacy: pharmacyId,
                hospital: hospitalId,
                grnDate: new Date(),
              },
            ],
            { session },
          );
        }
      }

      await session.commitTransaction();
      addedCount++;
    } catch (err: any) {
      await session.abortTransaction();
      errorCount++;
      errors.push({
        sku: item.sku,
        brandName: item.brandName,
        message: err.message,
      });
    } finally {
      session.endSession();
    }
  }

  // 🚀 PERFORMANCE FIX: Invalidate dashboard stats cache once after bulk operation
  await redisService.del(`pharma:dashboard:stats:${pharmacyId}`);

  res.status(200).json({
    success: true,
    addedCount,
    errorCount,
    errors,
  });
};

import fs from "fs";
import csv from "csv-parser";
import ExcelJS from "exceljs";

export const bulkImportProducts = async (req: PharmaRequest, res: Response) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ success: false, message: "Please upload a CSV file" });
  }

  const results: any[] = [];
  const errors: any[] = [];
  let successCount = 0;
  const pharmacyId = req.pharma?._id;
  const hospitalId = req.pharma?.hospital;

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", async () => {
      try {
        for (let i = 0; i < results.length; i++) {
          const row = results[i];
          try {
            let supplierId: any = undefined;
            const supplierVal = row.supplier?.trim();

            if (supplierVal) {
              if (mongoose.Types.ObjectId.isValid(supplierVal)) {
                supplierId = supplierVal;
              } else {
                const foundSupplier = await Supplier.findOne({
                  pharmacy: pharmacyId,
                  name: { $regex: new RegExp("^" + supplierVal + "$", "i") },
                });
                if (foundSupplier) supplierId = foundSupplier._id;
              }
            }

            const productData = {
              brand: row.brand?.trim(),
              generic: row.generic?.trim(),
              name: row.name?.trim() || row.brand?.trim(),
              sku: row.sku?.trim(),
              strength: row.strength?.trim(),
              form: row.form?.toUpperCase().trim() || "TABLET",
              mrp: parseFloat(row.mrp) || 0,
              gstPercent:
                parseInt(row.gstPercent) || parseInt(row.gstPct) || 12,
              hsnCode: row.hsnCode?.trim(),
              batchNumber: row.batchNumber?.trim(),
              expiryDate: resolveExpiryDate(row.expiryDate),
              minStock: parseInt(row.minStock) || 10,
              stock: parseInt(row.stock) || 0,
              unitCost: parseFloat(row.unitCost) || 0,
              unitsPerPack: parseInt(row.unitsPerPack) || 1,
              pharmacy: pharmacyId,
              hospital: hospitalId,
              supplier: supplierId,
              isActive: true,
            };

            if (!productData.brand || !productData.generic) {
              throw new Error(
                `Row ${i + 1}: Brand and Generic Name are required`,
              );
            }

            const product = await Product.create(productData);

            // Create initial batch if stock > 0
            if (
              productData.stock > 0 &&
              productData.batchNumber &&
              productData.expiryDate
            ) {
              await Batch.create({
                product: product._id,
                batchNo: productData.batchNumber,
                expiry: productData.expiryDate,
                qtyReceived: productData.stock,
                qtySold: 0,
                unitCost: productData.unitCost,
                supplier: supplierId,
                pharmacy: pharmacyId,
                hospital: hospitalId,
              });
            }

            successCount++;
          } catch (err: any) {
            errors.push({ row: i + 1, error: err.message });
          }
        }

        fs.unlinkSync(req.file!.path);

        // 🚀 PERFORMANCE FIX: Invalidate dashboard stats cache
        await redisService.del(`pharma:dashboard:stats:${pharmacyId}`);

        res.status(200).json({
          success: true,
          message: `Import completed: ${successCount} successful, ${errors.length} failed`,
          data: {
            total: results.length,
            success: successCount,
            failed: errors.length,
            errors,
          },
        });
      } catch (error: any) {
        if (fs.existsSync(req.file!.path)) fs.unlinkSync(req.file!.path);
        res.status(500).json({ message: error.message });
      }
    });
};

export const exportProductsToExcel = async (
  req: PharmaRequest,
  res: Response,
) => {
  try {
    const pharmacyId = req.pharma?._id;
    const products = await Product.find({
      pharmacy: pharmacyId,
      isActive: true,
    })
      .populate("supplier", "name")
      .lean();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Products");

    worksheet.columns = [
      { header: "Brand Name", key: "brand", width: 20 },
      { header: "Generic Name", key: "generic", width: 20 },
      { header: "SKU", key: "sku", width: 15 },
      { header: "Form", key: "form", width: 10 },
      { header: "MRP", key: "mrp", width: 10 },
      { header: "Stock", key: "stock", width: 10 },
      { header: "Min Stock", key: "minStock", width: 10 },
      { header: "Expiry", key: "expiryDate", width: 15 },
      { header: "Supplier", key: "supplierName", width: 20 },
    ];

    products.forEach((p: any) => {
      worksheet.addRow({
        brand: p.brand,
        generic: p.generic,
        sku: p.sku,
        form: p.form,
        mrp: p.mrp,
        stock: p.stock,
        minStock: p.minStock,
        expiryDate: p.expiryDate
          ? new Date(p.expiryDate).toLocaleDateString()
          : "N/A",
        supplierName: p.supplier?.name || "N/A",
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", "attachment; filename=products.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
