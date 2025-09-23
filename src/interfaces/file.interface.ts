export interface IFile {
  encoding: string;
  buffer: Buffer;
  fieldname: string;
  mimetype: string;
  originalname: string;
  size: number;
  ACL?: string;
}
