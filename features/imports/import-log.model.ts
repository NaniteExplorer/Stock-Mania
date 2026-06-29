import { Model, Schema, model, models } from "mongoose";

export type ImportStatus = "IMPORTED" | "SKIPPED" | "ERROR";

export interface ImportLogDoc {
  fileId: string;
  modifiedTime: string;
  fileName: string;
  status: ImportStatus;
  tradesBooked: number;
  error: string | null;
  ranAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ImportLogSchema = new Schema<ImportLogDoc>(
  {
    fileId: { type: String, required: true },
    modifiedTime: { type: String, required: true },
    fileName: { type: String, required: true },
    status: { type: String, required: true, enum: ["IMPORTED", "SKIPPED", "ERROR"] },
    tradesBooked: { type: Number, default: 0 },
    error: { type: String, default: null },
    ranAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// A given file version is processed at most once.
ImportLogSchema.index({ fileId: 1, modifiedTime: 1 }, { unique: true });

export const ImportLog: Model<ImportLogDoc> =
  (models?.importlog as Model<ImportLogDoc>) || model<ImportLogDoc>("importlog", ImportLogSchema);
