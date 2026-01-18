# Backend Package Description

This document describes the package structure of the `sport-zone` backend, mapping the physical directory structure to the logical architecture layers.

01 Modules [file:///d:/FU/sport-zone/src/modules]
Represents the core feature modules of the application. Each module encapsulates a specific business domain (e.g., Bookings, Tournaments, Users) and contains its own controllers, services, and data models.

02 Controllers [file:///d:/FU/sport-zone/src/modules] (within each module: `*.controller.ts`)
The Presentation Layer. Defines the entry points for the application's API. They handle incoming HTTP requests, validate input, and delegate the business logic to the appropriate services.

03 Services [file:///d:/FU/sport-zone/src/modules] (within each module: `*.service.ts`)
The Application Layer. Contains the core business logic. Services process requests from controllers, apply system rules, and interact with schemas/models to perform data operations.

04 DTOs [file:///d:/FU/sport-zone/src/modules] (within each module: `/dto`)
Data Transfer Objects used to define the structure of data sent over the network. They ensure type safety and validation for request bodies and responses.

05 Middleware [file:///d:/FU/sport-zone/src/middleware]
Processing layer for incoming requests. Handles cross-cutting concerns like logging, request transformation, or security checks before they reach the controllers.

06 Configuration [file:///d:/FU/sport-zone/src/config]
Infrastructure Layer. Holds global configuration files, including environment setup, database connections, and application-level settings.

07 Helpers & Utils [file:///d:/FU/sport-zone/src/shared/helpers] / [file:///d:/FU/sport-zone/src/utils]
Infrastructure Layer. Contains utility functions and helper classes used throughout the system for common tasks like date formatting, encryption, or string manipulation.

08 Common [file:///d:/FU/sport-zone/src/common]
Core Layer. Contains shared components, enums, constants, and base classes used across multiple modules. It ensures consistency and reusability.

09 Models & Schemas [file:///d:/FU/sport-zone/src/modules] (within each module: `/schema` or `/entities`)
Core Layer. Defines the data models and database schemas. They represent the structure of the data stored in the database and provide an interface for data access.

10 Types & Interfaces [file:///d:/FU/sport-zone/src/interfaces]
Defines TypeScript type declarations and interfaces. Ensures type safety and better code readability across all layers of the application.

11 Guards & Interceptors [file:///d:/FU/sport-zone/src/common/guards] / [file:///d:/FU/sport-zone/src/common/interceptors]
Cross-cutting security and logging layers. Guards handle authentication and authorization, while Interceptors transform request/response data or handle exceptions.
