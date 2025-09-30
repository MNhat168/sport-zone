import { FieldOwnerProfile } from "../entities/field-owner-profile.entity";
import { SchemaFactory } from "@nestjs/mongoose";

export const FieldOwnerProfileSchema = SchemaFactory.createForClass(FieldOwnerProfile);